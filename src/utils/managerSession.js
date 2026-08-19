// src/utils/managerSession.js
//
// Enforces "one active session per manager account" by storing a
// per-login session id on manager.active_session_id and comparing it
// against a tab-scoped id kept in sessionStorage.
//
// A fresh login (claimManagerSessionIfFree) only succeeds while the
// account is unclaimed — if someone else is already signed in, the new
// attempt is rejected outright instead of stealing the slot and forcing
// the other side out. The claim is released immediately when that other
// side logs out normally.
//
// A clean tab/browser close is ALSO supposed to release it immediately
// (releaseManagerSessionClaimBeacon, wired up on `pagehide` in
// AuthContext) — but that release call needs an Authorization header to
// identify the manager, and any fetch with a custom header requires a
// CORS preflight first. Browsers do not reliably finish a preflighted
// request during page unload (this is a well-known keepalive/fetch
// limitation, not specific to this app), so on a real tab close that
// release can silently fail to land far more often than you'd expect.
//
// Because of that, this can't be the only line of defense — active_session
// is also treated as a rolling heartbeat (refreshManagerSessionHeartbeat,
// called every HEARTBEAT_INTERVAL_MS by AuthContext while a tab is open).
// claimManagerSessionIfFree treats a claim whose heartbeat is older than
// STALE_SESSION_MS as abandoned and takes it over automatically, so even
// if the unload beacon never lands, a closed tab's lock expires on its
// own within a few minutes instead of blocking logins forever.
//
// Requires the SQL migration in sql/manager_session_lock.sql to be run
// against the Supabase project (adds the column + enables Realtime on
// public.manager) before this has any effect.
import { supabase, supabaseUrl, supabaseAnonKey } from '../supabase';

const TAB_SESSION_KEY = 'cs_tab_session_id';

// How often an open tab refreshes its heartbeat, and how old a heartbeat
// has to be before a claim is considered abandoned. The gap between them
// (3x) tolerates a couple of missed ticks (a slow network, a backgrounded
// tab getting throttled) without falsely evicting a still-active session.
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const STALE_SESSION_MS = 3 * 60 * 1000;

function readTabSessionId() {
  return sessionStorage.getItem(TAB_SESSION_KEY);
}

function writeTabSessionId(id) {
  sessionStorage.setItem(TAB_SESSION_KEY, id);
}

// Claims the manager's session slot if nobody else currently holds it, OR
// if whoever does hasn't heartbeated in over STALE_SESSION_MS (their tab
// is presumed closed/dead). Only call this right after a fresh,
// fully-authenticated login.
//
// Returns { claimed: true, tabSessionId } on success, or
// { claimed: false, activeSince } if another device/browser genuinely
// still holds the claim — the caller is responsible for rejecting this
// login attempt (sign the just-created auth session back out) rather than
// granting access.
export async function claimManagerSessionIfFree(managerId) {
  const tabSessionId = crypto.randomUUID();

  // Attempt 1: nobody holds the claim at all — the common, fast path.
  const { data: freshClaim, error: freshError } = await supabase
    .from('manager')
    .update({
      active_session_id: tabSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId)
    .is('active_session_id', null)
    .select('manager_id');
  if (freshError) throw freshError;

  if (freshClaim && freshClaim.length > 0) {
    writeTabSessionId(tabSessionId);
    return { claimed: true, tabSessionId };
  }

  // Someone holds it — check whether their heartbeat is stale enough to
  // mean their tab is actually gone (closed without the unload beacon
  // landing, crashed, lost power, etc.) rather than genuinely still open.
  const { data: existing, error: readError } = await supabase
    .from('manager')
    .select('active_session_id, active_session_started_at')
    .eq('manager_id', managerId)
    .maybeSingle();
  if (readError) throw readError;

  const heartbeatAt = existing?.active_session_started_at ? new Date(existing.active_session_started_at).getTime() : 0;
  const isStale = !existing?.active_session_id || (Date.now() - heartbeatAt) > STALE_SESSION_MS;

  if (!isStale) {
    return { claimed: false, activeSince: existing.active_session_started_at || null };
  }

  // Attempt 2: take over the stale claim — conditioned on it still being
  // the EXACT claim we just read (same id, heartbeat still older than the
  // cutoff), so a session that heartbeats in the narrow window between
  // our read and this write isn't clobbered out from under it.
  const { data: staleClaim, error: staleError } = await supabase
    .from('manager')
    .update({
      active_session_id: tabSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId)
    .eq('active_session_id', existing.active_session_id)
    .lt('active_session_started_at', new Date(Date.now() - STALE_SESSION_MS).toISOString())
    .select('manager_id');
  if (staleError) throw staleError;

  if (!staleClaim || staleClaim.length === 0) {
    // Lost the race — the other side heartbeated (or someone else already
    // reclaimed it) between our read and this write.
    return { claimed: false, activeSince: null };
  }

  writeTabSessionId(tabSessionId);
  return { claimed: true, tabSessionId };
}

// Best-effort heartbeat — called on an interval by AuthContext for as
// long as a tab holds the claim, so claimManagerSessionIfFree can tell a
// genuinely still-open tab apart from one that silently died. Only
// refreshes if we still own the claim (matches on tabSessionId too), so
// a tab that already got superseded doesn't stomp on whoever replaced it.
export async function refreshManagerSessionHeartbeat(managerId, tabSessionId) {
  if (!managerId || !tabSessionId) return;
  try {
    await supabase
      .from('manager')
      .update({ active_session_started_at: new Date().toISOString() })
      .eq('manager_id', managerId)
      .eq('active_session_id', tabSessionId);
  } catch {
    // best-effort — a missed heartbeat just leaves the claim looking
    // slightly stale for a bit longer; the next successful one fixes it.
  }
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
