// src/utils/managerSession.js
//
// Enforces "one active session per manager account" by storing a
// per-login session id on manager.active_session_id and comparing it
// against a tab-scoped id kept in sessionStorage.
//
// A fresh login (claimManagerSessionIfFree) only succeeds while the
// account is unclaimed — if someone else is already signed in, the new
// attempt is rejected outright instead of stealing the slot and forcing
// the other side out. The claim is released when that other side logs
// out normally, or automatically when their tab/browser closes (see
// releaseManagerSessionClaimBeacon, wired up on `pagehide` in
// AuthContext) — so a blocked login attempt is never a permanent lockout,
// just "try again once the other session actually ends."
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

// Claims the manager's session slot ONLY if nobody else currently holds
// it. Only call this right after a fresh, fully-authenticated login.
//
// Returns { claimed: true, tabSessionId } on success, or
// { claimed: false, activeSince } if another device/browser already
// holds the claim — the caller is responsible for rejecting this login
// attempt (sign the just-created auth session back out) rather than
// granting access.
export async function claimManagerSessionIfFree(managerId) {
  const tabSessionId = crypto.randomUUID();

  // Read first so a rejected attempt can tell the user *when* the other
  // session started, for a clearer message.
  const { data: existing, error: readError } = await supabase
    .from('manager')
    .select('active_session_id, active_session_started_at')
    .eq('manager_id', managerId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing?.active_session_id) {
    return { claimed: false, activeSince: existing.active_session_started_at || null };
  }

  // Conditional write — only succeeds if still unclaimed by the time this
  // lands, closing the race where two logins both read "free" at once.
  const { data: updated, error: updateError } = await supabase
    .from('manager')
    .update({
      active_session_id: tabSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId)
    .is('active_session_id', null)
    .select('manager_id');
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    return { claimed: false, activeSince: null };
  }

  writeTabSessionId(tabSessionId);
  return { claimed: true, tabSessionId };
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
//
// Deliberately does NOT filter out "our own" updates here by snapshotting
// the claim id at subscribe time — that snapshot could go stale if the
// caller re-claims without re-subscribing. Instead every UPDATE is handed
// to onKicked(newId, startedAt) and the CALLER compares newId against its
// own live/current id, so there's no window where a stale local id can
// cause a false self-kick.
export function subscribeManagerSession(managerId, onKicked) {
  const channel = supabase
    .channel(`manager-session-${managerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'manager', filter: `manager_id=eq.${managerId}` },
      (payload) => {
        const newId = payload.new?.active_session_id;
        onKicked(newId, payload.new?.active_session_started_at);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
