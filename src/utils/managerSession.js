// src/utils/managerSession.js
//
// Enforces "one active BROWSER session per manager account" by storing a
// per-login session id on manager.active_session_id and comparing it
// against an id kept in localStorage — deliberately localStorage, not
// sessionStorage, because it must be SHARED across every tab of the same
// browser (see below).
//
// A fresh login (claimManagerSessionIfFree) only succeeds while the
// account is unclaimed — if someone else is already signed in, the new
// attempt is rejected outright instead of stealing the slot and forcing
// the other side out. The claim is released immediately on explicit
// logout.
//
// Why per-BROWSER and not per-TAB: Supabase's auth session (the actual
// login token) already lives in localStorage, shared by every tab of one
// browser — opening a second tab doesn't create a second login, it just
// reads the same one. An earlier version of this file scoped the claim
// per-tab (sessionStorage), so a second tab of the SAME already-logged-in
// browser would generate its own id, see it didn't match the first tab's,
// and treat itself as "kicked" — which called supabase.auth.signOut().
// That signOut call clears the shared localStorage auth token, which
// every tab of that browser reacts to instantly (that's how Supabase
// keeps tabs in sync) — so opening a second tab silently logged out BOTH
// tabs, including the legitimate first one. Scoping the claim id to the
// browser (localStorage) instead means every tab of one browser shares
// one id and one claim, so they never conflict with each other — only a
// genuinely different browser/device, which has its own separate
// localStorage, can ever end up with a different id.
//
// A claim only ever needs to be released when the LAST tab of a browser
// goes away, and there's no reliable way to detect "am I the last tab
// closing" from an unload handler — so this deliberately does NOT try to
// release on tab/browser close anymore (an earlier version attempted
// this via a keepalive fetch beacon, but that also needs an Authorization
// header, which forces a CORS preflight that browsers don't reliably
// finish during unload — AND releasing on any one tab's close would have
// incorrectly freed the slot while sibling tabs of the same browser were
// still open and using it). Instead, active_session_started_at is treated
// as a rolling heartbeat (refreshManagerSessionHeartbeat, called every
// HEARTBEAT_INTERVAL_MS by AuthContext for as long as any tab is open).
// claimManagerSessionIfFree treats a claim whose heartbeat is older than
// STALE_SESSION_MS as abandoned and takes it over automatically — so a
// browser that's fully closed (all tabs gone, whether cleanly or via a
// crash) frees its claim within a few minutes on its own, with no
// dependency on an unload event firing correctly at all.
//
// Requires the SQL migration in sql/manager_session_lock.sql to be run
// against the Supabase project (adds the column + enables Realtime on
// public.manager) before this has any effect.
import { supabase } from '../supabase';

const BROWSER_SESSION_KEY = 'cs_browser_session_id';

// How often an open tab refreshes its heartbeat, and how old a heartbeat
// has to be before a claim is considered abandoned. The gap between them
// (3x) tolerates a couple of missed ticks (a slow network, a backgrounded
// tab getting throttled) without falsely evicting a still-active session.
// Kept short on purpose: a closed browser should free the account for
// someone else within seconds, not minutes.
export const HEARTBEAT_INTERVAL_MS = 10 * 1000;
export const STALE_SESSION_MS = 30 * 1000;

function readBrowserSessionId() {
  return localStorage.getItem(BROWSER_SESSION_KEY);
}

function writeBrowserSessionId(id) {
  localStorage.setItem(BROWSER_SESSION_KEY, id);
}

// Claims the manager's session slot if nobody else currently holds it, OR
// if whoever does hasn't heartbeated in over STALE_SESSION_MS (their
// browser is presumed closed/dead). Only call this right after a fresh,
// fully-authenticated login.
//
// Returns { claimed: true, browserSessionId } on success, or
// { claimed: false, activeSince } if another browser/device genuinely
// still holds the claim — the caller is responsible for rejecting this
// login attempt (sign the just-created auth session back out) rather than
// granting access.
export async function claimManagerSessionIfFree(managerId) {
  const browserSessionId = crypto.randomUUID();

  // Attempt 1: nobody holds the claim at all — the common, fast path.
  const { data: freshClaim, error: freshError } = await supabase
    .from('manager')
    .update({
      active_session_id: browserSessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('manager_id', managerId)
    .is('active_session_id', null)
    .select('manager_id');
  if (freshError) throw freshError;

  if (freshClaim && freshClaim.length > 0) {
    writeBrowserSessionId(browserSessionId);
    return { claimed: true, browserSessionId };
  }

  // Someone holds it — check whether their heartbeat is stale enough to
  // mean their browser is actually gone (closed, crashed, lost power)
  // rather than genuinely still open.
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
      active_session_id: browserSessionId,
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

  writeBrowserSessionId(browserSessionId);
  return { claimed: true, browserSessionId };
}

// Best-effort heartbeat — called on an interval by AuthContext for as
// long as ANY tab of this browser holds the claim, so
// claimManagerSessionIfFree can tell a genuinely still-open browser apart
// from one that silently died. Only refreshes if we still own the claim
// (matches on browserSessionId too), so a browser that already got
// superseded doesn't stomp on whoever replaced it.
export async function refreshManagerSessionHeartbeat(managerId, browserSessionId) {
  if (!managerId || !browserSessionId) return;
  try {
    await supabase
      .from('manager')
      .update({ active_session_started_at: new Date().toISOString() })
      .eq('manager_id', managerId)
      .eq('active_session_id', browserSessionId);
  } catch {
    // best-effort — a missed heartbeat just leaves the claim looking
    // slightly stale for a bit longer; the next successful one fixes it.
  }
}

// Called on page load / token refresh (NOT a fresh login) by every tab of
// a browser that already has a valid Supabase auth session. Since the id
// is shared via localStorage, every tab of the SAME browser reads the
// SAME id and will match whatever that browser already claimed — this
// only reports 'kicked' when a genuinely different browser/device holds
// the claim instead.
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
    return { status: 'unknown', browserSessionId };
  }

  const dbSessionId = data?.active_session_id;

  if (!dbSessionId) {
    const { error: reclaimError } = await supabase
      .from('manager')
      .update({ active_session_id: browserSessionId, active_session_started_at: new Date().toISOString() })
      .eq('manager_id', managerId);
    if (reclaimError) return { status: 'unknown', browserSessionId };
    return { status: 'reclaimed', browserSessionId };
  }

  if (dbSessionId !== browserSessionId) {
    return { status: 'kicked', browserSessionId };
  }

  return { status: 'ok', browserSessionId };
}

// Best-effort, awaited release — used on explicit logout. Since the claim
// is shared by every tab of this browser, this correctly logs every tab
// of it out together too (via Supabase's own cross-tab session sync from
// the auth.signOut() call the caller makes right after this) — which is
// exactly the expected behavior for a deliberate "Log out" action.
export async function releaseManagerSessionClaim(managerId, browserSessionId) {
  if (!managerId || !browserSessionId) return;
  try {
    await supabase
      .from('manager')
      .update({ active_session_id: null })
      .eq('manager_id', managerId)
      .eq('active_session_id', browserSessionId);
  } catch {
    // best-effort
  }
}

// Subscribes to realtime changes on this manager's row so an open browser
// is kicked out the instant a genuinely DIFFERENT browser/device claims
// the session, rather than only finding out on its next reload. Returns
// an unsubscribe fn.
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
