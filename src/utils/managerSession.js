// src/utils/managerSession.js
//
// Enforces "one active device/tab per manager account" by storing a
// per-login session id on manager.active_session_id and comparing it
// against a tab-scoped id kept in sessionStorage.
//
// Requires the SQL migration in sql/manager_session_lock.sql to be run
// against the Supabase project (adds the column + enables Realtime on
// public.manager) before this has any effect.
import { supabase, supabaseUrl, supabaseAnonKey } from '../supabase';

const TAB_SESSION_KEY = 'cs_tab_session_id';

function readTabSessionId() {
  return sessionStorage.getItem(TAB_SESSION_KEY);
}

function writeTabSessionId(id) {
  sessionStorage.setItem(TAB_SESSION_KEY, id);
}

// Unconditionally takes ownership of the manager's active session,
// kicking out whatever device/tab was previously logged in as them.
// Only call this right after a fresh, fully-authenticated login.
export async function claimManagerSession(managerId) {
  const tabSessionId = crypto.randomUUID();
  writeTabSessionId(tabSessionId);
  const { error } = await supabase
    .from('manager')
    .update({
      active_session_id: tabSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId);
  if (error) throw error;
  return tabSessionId;
}

// Called on page load / token refresh (NOT a fresh login). If nobody else
// holds the claim, this tab silently takes it over so refreshing the page
// doesn't break the session. If another still-active session holds it,
// reports 'kicked' so the caller can sign this tab out.
export async function verifyOrReclaimManagerSession(managerId) {
  let tabSessionId = readTabSessionId();
  if (!tabSessionId) {
    tabSessionId = crypto.randomUUID();
    writeTabSessionId(tabSessionId);
  }

  const { data, error } = await supabase
    .from('manager')
    .select('active_session_id')
    .eq('manager_id', managerId)
    .maybeSingle();

  if (error) {
    // Transient/network error — don't punish the user for a flaky request.
    return { status: 'unknown', tabSessionId };
  }

  const dbSessionId = data?.active_session_id;

  if (!dbSessionId) {
    const { error: reclaimError } = await supabase
      .from('manager')
      .update({ active_session_id: tabSessionId, active_session_started_at: new Date().toISOString() })
      .eq('manager_id', managerId);
    if (reclaimError) return { status: 'unknown', tabSessionId };
    return { status: 'reclaimed', tabSessionId };
  }

  if (dbSessionId !== tabSessionId) {
    return { status: 'kicked', tabSessionId };
  }

  return { status: 'ok', tabSessionId };
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
// kicked out the instant another device/tab claims the session, rather
// than only finding out on its next reload. Returns an unsubscribe fn.
export function subscribeManagerSession(managerId, onKicked) {
  const tabSessionId = readTabSessionId();
  const channel = supabase
    .channel(`manager-session-${managerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'manager', filter: `manager_id=eq.${managerId}` },
      (payload) => {
        const newId = payload.new?.active_session_id;
        if (newId && newId !== tabSessionId) {
          onKicked();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
