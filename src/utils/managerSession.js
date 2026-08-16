// src/utils/managerSession.js
//
// Enforces "one active browser/device per manager account" by storing a
// per-login session id on manager.active_session_id and comparing it
// against a browser-scoped id kept in localStorage. Because it's in
// localStorage (not sessionStorage), every tab of the SAME browser shares
// this id — opening a second tab of an already-logged-in browser just
// joins the existing session instead of being treated as a takeover.
// Only a genuinely different browser/profile/device (separate localStorage)
// triggers the takeover confirmation.
//
// Requires the SQL migration in sql/manager_session_lock.sql to be run
// against the Supabase project (adds the column + enables Realtime on
// public.manager) before this has any effect.
import { supabase, supabaseUrl, supabaseAnonKey } from '../supabase';

const BROWSER_SESSION_KEY = 'cs_browser_session_id';
const THIS_TAB_ID_KEY = 'cs_this_tab_id'; // per-tab on purpose (sessionStorage)
const OPEN_TABS_KEY = 'cs_open_tabs'; // { [tabId]: lastSeenTimestamp }
const STALE_TAB_MS = 90 * 1000; // ignore heartbeats older than this (crashed/killed tabs)

function readBrowserSessionId() {
  return localStorage.getItem(BROWSER_SESSION_KEY);
}

function writeBrowserSessionId(id) {
  localStorage.setItem(BROWSER_SESSION_KEY, id);
}

// Unique per physical tab (deliberately sessionStorage) — used only to
// tell this browser's own tabs apart from each other in the open-tabs
// registry below, not for session ownership.
function getThisTabId() {
  let id = sessionStorage.getItem(THIS_TAB_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(THIS_TAB_ID_KEY, id);
  }
  return id;
}

function readOpenTabs() {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOpenTabs(tabs) {
  localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs));
}

// Marks this tab as alive. Call on establishing a session and periodically
// afterward (heartbeat) so other tabs of this browser know it's still open.
export function registerOpenTab() {
  const tabs = readOpenTabs();
  tabs[getThisTabId()] = Date.now();
  writeOpenTabs(tabs);
}

// Removes this tab from the registry (call on close/unload) and reports
// whether any OTHER tab of this browser is still alive, so the caller can
// decide whether it's safe to release the account-level claim.
export function unregisterOpenTab() {
  const tabs = readOpenTabs();
  delete tabs[getThisTabId()];
  const now = Date.now();
  const stillAlive = Object.values(tabs).some(ts => now - ts < STALE_TAB_MS);
  writeOpenTabs(tabs);
  return !stillAlive;
}

// Read-only check used right before a fresh login finalizes: is someone
// else already holding the claim? Returns null if the coast is clear, or
// { since } if another browser/device currently owns the session — the
// caller can then ask the person logging in to confirm before we steal it.
export async function peekManagerSessionConflict(managerId) {
  const { data, error } = await supabase
    .from('manager')
    .select('active_session_id, active_session_started_at')
    .eq('manager_id', managerId)
    .maybeSingle();
  if (error || !data?.active_session_id) return null;
  return { since: data.active_session_started_at };
}

// Unconditionally takes ownership of the manager's active session,
// kicking out whatever browser/device was previously logged in as them.
// Only call this right after a fresh, fully-authenticated login.
export async function claimManagerSession(managerId) {
  const browserSessionId = crypto.randomUUID();
  writeBrowserSessionId(browserSessionId);
  const { error } = await supabase
    .from('manager')
    .update({
      active_session_id: browserSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId);
  if (error) throw error;
  return browserSessionId;
}

// Called on page load / token refresh (NOT a fresh login). If nobody else
// holds the claim, this browser silently takes it over so refreshing (or
// opening another tab) doesn't break the session. If another still-active
// session holds it, reports 'kicked' so the caller can sign this tab out.
export async function verifyOrReclaimManagerSession(managerId) {
  let browserSessionId = readBrowserSessionId();
  if (!browserSessionId) {
    browserSessionId = crypto.randomUUID();
    writeBrowserSessionId(browserSessionId);
  }

  const { data, error } = await supabase
    .from('manager')
    .select('active_session_id')
    .eq('manager_id', managerId)
    .maybeSingle();

  if (error) {
    // Transient/network error — don't punish the user for a flaky request.
    return { status: 'unknown', tabSessionId: browserSessionId };
  }

  const dbSessionId = data?.active_session_id;

  if (!dbSessionId) {
    const { error: reclaimError } = await supabase
      .from('manager')
      .update({ active_session_id: browserSessionId, active_session_started_at: new Date().toISOString() })
      .eq('manager_id', managerId);
    if (reclaimError) return { status: 'unknown', tabSessionId: browserSessionId };
    return { status: 'reclaimed', tabSessionId: browserSessionId };
  }

  if (dbSessionId !== browserSessionId) {
    return { status: 'kicked', tabSessionId: browserSessionId };
  }

  return { status: 'ok', tabSessionId: browserSessionId };
}

// Best-effort, awaited release — used on explicit logout.
export async function releaseManagerSessionClaim(managerId, tabSessionId) {
  if (!managerId || !tabSessionId) return;
  try {
    await supabase
      .from('manager')
      .update({ active_session_id: null })
      .eq('manager_id', managerId)
      .eq('active_session_id', tabSessionId);
  } catch {
    // best-effort
  }
}

// Fire-and-forget release for page unload (tab close/refresh). Uses a raw
// keepalive fetch instead of the supabase client because the browser will
// otherwise cancel an in-flight request when the page unloads.
export function releaseManagerSessionClaimBeacon(managerId, tabSessionId, accessToken) {
  if (!managerId || !tabSessionId || !accessToken) return;
  try {
    fetch(
      `${supabaseUrl}/rest/v1/manager?manager_id=eq.${encodeURIComponent(managerId)}&active_session_id=eq.${encodeURIComponent(tabSessionId)}`,
      {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ active_session_id: null }),
      }
    );
  } catch {
    // best-effort — page is unloading, nothing else we can do
  }
}

// Subscribes to realtime changes on this manager's row so an open tab is
// kicked out the instant another browser/device claims the session, rather
// than only finding out on its next reload. Returns an unsubscribe fn.
export function subscribeManagerSession(managerId, onKicked) {
  const browserSessionId = readBrowserSessionId();
  const channel = supabase
    .channel(`manager-session-${managerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'manager', filter: `manager_id=eq.${managerId}` },
      (payload) => {
        const newId = payload.new?.active_session_id;
        if (newId && newId !== browserSessionId) {
          onKicked(payload.new?.active_session_started_at);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
