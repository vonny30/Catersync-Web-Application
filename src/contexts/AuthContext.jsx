// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import {
  claimManagerSessionIfFree,
  verifyOrReclaimManagerSession,
  releaseManagerSessionClaim,
  refreshManagerSessionHeartbeat,
  subscribeManagerSession,
  HEARTBEAT_INTERVAL_MS,
} from '../utils/managerSession';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True only until the very first session check (app boot) resolves.
  // This is what gates the full-screen LoadingScreen — later auth events
  // (login submit, background token refresh) toggle `loading` without
  // blanking the whole app, so the UI doesn't flicker/reload mid-flow.
  const [initializing, setInitializing] = useState(true);
  const [isManager, setIsManager] = useState(false);
  // Set when a fresh login attempt is rejected because the account is
  // already signed in elsewhere. Login.jsx surfaces this as its own
  // inline error banner (same spot as "wrong password", etc.) instead of
  // a toast, since the person seeing it is sitting right there on the
  // login form.
  const [sessionConflictMessage, setSessionConflictMessage] = useState(null);
  const clearSessionConflictMessage = () => setSessionConflictMessage(null);
  // Supabase fires the SAME 'SIGNED_IN' event both for an actual credential
  // login AND for a brand-new tab picking up an already-valid session from
  // shared storage — there's no way to tell them apart from the event
  // itself. Login.jsx sets this flag right before calling
  // signInWithPassword so the listener below knows the very next SIGNED_IN
  // is a real login attempt (and should go through the strict
  // claim-or-reject check) rather than just a new tab opening (which
  // should join the existing session, not compete with it).
  const freshLoginAttemptRef = useRef(false);
  const markFreshLoginAttempt = () => {
    freshLoginAttemptRef.current = true;
  };
  const isBlockedRef = useRef(false);
  const kickedAtRef = useRef(null);
  const isCreatingWalkIn = useRef(false);
  const inactivityTimerRef = useRef(null);
  const retryCount = useRef(0);
  const maxRetries = 2;
  const logoutTimeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const isInactiveLogoutRef = useRef(false);
  const isManualLogout = useRef(false);
  const isKickedRef = useRef(false);
  // Set when a page deliberately signs the manager out after already
  // explaining why (e.g. password/email changed) — suppresses the generic
  // logout toast so we don't show a second, redundant/confusing message.
  const isSilentLogoutRef = useRef(false);
  // Every logout-related toast shares this id so react-hot-toast replaces
  // the previous one instead of stacking duplicates if more than one
  // auth event fires in quick succession (e.g. during a password change).
  const AUTH_TOAST_ID = 'auth-status';

  // Identifies which manager / browser-session this browser currently owns
  // (shared across every tab of it — see managerSession.js).
  const managerIdRef = useRef(null);
  const browserSessionIdRef = useRef(null);
  const realtimeUnsubRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);

  const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

  const clearInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  };

  const resetInactivityTimer = () => {
    const rememberMe = localStorage.getItem('rememberMe') === 'true';
    if (!user || rememberMe) {
      clearInactivityTimer();
      return;
    }
    clearInactivityTimer();
    lastActivityRef.current = Date.now();

    const checkInactivity = () => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= INACTIVITY_TIMEOUT) {
        isInactiveLogoutRef.current = true;
        logout(true);
        return;
      }
      inactivityTimerRef.current = setTimeout(checkInactivity, 30000);
    };
    inactivityTimerRef.current = setTimeout(checkInactivity, 30000);
  };

  const updateActivity = () => {
    lastActivityRef.current = Date.now();
    if (user) {
      const rememberMe = localStorage.getItem('rememberMe') === 'true';
      if (!rememberMe) {
        clearInactivityTimer();
        resetInactivityTimer();
      }
    }
  };

  const teardownSessionLock = () => {
    if (realtimeUnsubRef.current) {
      realtimeUnsubRef.current();
      realtimeUnsubRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    managerIdRef.current = null;
    browserSessionIdRef.current = null;
  };

  // Called on every realtime UPDATE to this manager's row, including ones
  // caused by OUR OWN claim (Postgres changefeeds don't distinguish "who
  // made this change"). Must compare newSessionId against the live ref
  // (not a value captured earlier) or a stale comparison could make a tab
  // sign itself out right after successfully claiming the session.
  const handleKicked = (newSessionId, startedAt) => {
    if (!newSessionId || newSessionId === browserSessionIdRef.current) {
      console.log('[session-lock] Ignoring realtime update — this is our own claim.', { newSessionId, ours: browserSessionIdRef.current });
      return;
    }
    if (isKickedRef.current) return; // already handling
    console.log('[session-lock] Kicked — another device/tab claimed the session.', { newSessionId, ours: browserSessionIdRef.current, startedAt });
    isKickedRef.current = true;
    kickedAtRef.current = startedAt || null;
    teardownSessionLock();
    supabase.auth.signOut();
  };

  useEffect(() => {
    const activityEvents = [
      'mousedown', 'mousemove', 'keydown', 'keyup',
      'click', 'scroll', 'touchstart', 'pointerdown', 'wheel'
    ];
    activityEvents.forEach(event => {
      window.addEventListener(event, updateActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, updateActivity);
      });
      clearInactivityTimer();
    };
  }, [user]);

  // isFreshSignIn === true means "this call is completing an actual login"
  // — in that case we CLAIM the session, kicking out whatever device/tab
  // was previously logged in as this manager. Any other call (page load,
  // token refresh) only verifies/reclaims, never steals.
  const checkManager = async (authUser, isRetry = false, isFreshSignIn = false) => {
    try {
      const { data: manager, error } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (error) {
        if (error.status === 403 || error.status === 401) {
          throw new Error('Session expired');
        }
        throw error;
      }

      if (!manager) {
        await supabase.auth.signOut();
        setUser(null);
        setIsManager(false);
        return false;
      }

      // --- Single active session enforcement ---
      let lockResult;
      if (isFreshSignIn) {
        // A fresh login only succeeds while the account is unclaimed —
        // if it's already active elsewhere, THIS attempt is rejected;
        // the other side is never touched.
        const claim = await claimManagerSessionIfFree(manager.manager_id);
        if (!claim.claimed) {
          console.log('[session-lock] Blocked — account already active elsewhere.', claim);
          isBlockedRef.current = true;
          // activeSince is a rolling heartbeat, not the original login
          // time — worded as "active as of" rather than "signed in since"
          // so it doesn't read as a much-older login than it really is.
          const activeAsOf = claim.activeSince
            ? new Date(claim.activeSince).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : null;
          setSessionConflictMessage(
            activeAsOf
              ? `This account is already signed in on another device or browser (active as of ${activeAsOf}). Please log out there first, or wait a few minutes for that session to expire.`
              : 'This account is already signed in on another device or browser. Please log out there first, or wait a few minutes for that session to expire.'
          );
          // Local-scope only — this brand-new sign-in never should have
          // been granted app access, but revoking globally would also
          // invalidate the OTHER, still-legitimate session's tokens.
          await supabase.auth.signOut({ scope: 'local' });
          return false;
        }
        console.log('[session-lock] Claimed (fresh sign-in):', claim.browserSessionId);
        lockResult = { status: 'claimed', browserSessionId: claim.browserSessionId };
      } else {
        lockResult = await verifyOrReclaimManagerSession(manager.manager_id);
        console.log('[session-lock] verifyOrReclaim result:', lockResult.status, lockResult.browserSessionId);
      }

      if (lockResult.status === 'kicked') {
        isKickedRef.current = true;
        await supabase.auth.signOut();
        return false;
      }

      teardownSessionLock();
      managerIdRef.current = manager.manager_id;
      browserSessionIdRef.current = lockResult.browserSessionId;
      realtimeUnsubRef.current = subscribeManagerSession(manager.manager_id, handleKicked);
      // Keeps the claim looking "alive" for as long as any tab of this
      // browser is open — see the top-of-file comment in managerSession.js
      // for why this replaces trying to release on tab/browser close.
      heartbeatIntervalRef.current = setInterval(() => {
        refreshManagerSessionHeartbeat(managerIdRef.current, browserSessionIdRef.current);
      }, HEARTBEAT_INTERVAL_MS);

      setUser(authUser);
      setIsManager(true);
      retryCount.current = 0;
      const rememberMe = localStorage.getItem('rememberMe') === 'true';
      if (!rememberMe) resetInactivityTimer();
      return true;
    } catch (error) {
      console.error('Manager check error:', error);

      if (error.message === 'Session expired') {
        await supabase.auth.signOut();
        setUser(null);
        setIsManager(false);
        return false;
      }

      if (retryCount.current < maxRetries && !isRetry) {
        retryCount.current++;
        console.log(`Retrying manager check (attempt ${retryCount.current})...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return checkManager(authUser, true, isFreshSignIn);
      }

      if (!isRetry) {
        toast.error('Connection issue. Please refresh the page to continue.', { duration: 4000 });
      }
      setUser(authUser);
      setIsManager(true);
      retryCount.current = 0;
      return true;
    }
  };

  // Main session initialisation
  useEffect(() => {
    const initSession = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await checkManager(session.user);
        } else {
          setUser(null);
          setIsManager(false);
        }
      } catch (error) {
        console.error('Session error:', error);
        setUser(null);
        setIsManager(false);
      } finally {
        setLoading(false);
        setInitializing(false);
      }
    };

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (window._pendingWalkInCount > 0) {
          console.log(`Skipping auth event (${event}) – ${window._pendingWalkInCount} pending walk‑in creation(s).`);
          return;
        }

        console.log('Auth event:', event);

if (event === 'SIGNED_OUT') {
          clearInactivityTimer();
          teardownSessionLock();
          if (logoutTimeoutRef.current) clearTimeout(logoutTimeoutRef.current);

          if (isSilentLogoutRef.current) {
            // A page already explained why (e.g. "password updated,
            // you've been logged out for security") — don't pile on
            // another toast on top of it.
            isSilentLogoutRef.current = false;
          } else if (isInactiveLogoutRef.current) {
            toast.error('You were logged out after being inactive for a while.', { id: AUTH_TOAST_ID, duration: 4000 });
            isInactiveLogoutRef.current = false;
          } else if (isManualLogout.current) {
            toast.success('Logged out successfully', { id: AUTH_TOAST_ID });
            isManualLogout.current = false;
          } else if (isKickedRef.current) {
            const when = kickedAtRef.current
              ? new Date(kickedAtRef.current).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : null;
            toast.error(
              when
                ? `This account was signed in from another device or tab at ${when}, so you were logged out here.`
                : 'This account was just signed in from another device or tab, so you were logged out here.',
              { id: AUTH_TOAST_ID, duration: 6000 }
            );
            isKickedRef.current = false;
            kickedAtRef.current = null;
          } else if (isBlockedRef.current) {
            // Rejected fresh-login attempt — the specific reason is
            // already shown via sessionConflictMessage (Login.jsx renders
            // it as its own inline error), so skip the generic toast here.
            isBlockedRef.current = false;
          } else {
            // Only show this if they're not already on the login page —
            // avoids toast spam when we force a logout during email/password
            // updates. Plain-language wording, not "session expired".
            const isLoginPage = window.location.pathname === '/' || window.location.pathname === '/login';
            if (!isLoginPage) {
              toast.error('You were logged out. Please log in again.', { id: AUTH_TOAST_ID, duration: 4000 });
            }
          }

          logoutTimeoutRef.current = setTimeout(() => {
            setUser(null);
            setIsManager(false);
            setLoading(false);
          }, 500);
          return;
        }

        if (event === 'TOKEN_REFRESHED') {
          // Silent background refresh — re-verify without toggling the
          // loading flag, so it doesn't disrupt whatever the manager is
          // doing on screen.
          retryCount.current = 0;
          if (session?.user) {
            await checkManager(session.user);
          }
          return;
        }

        if (event === 'SIGNED_IN') {
          if (session?.user) {
            const isFreshSignIn = freshLoginAttemptRef.current;
            freshLoginAttemptRef.current = false;
            setLoading(true);
            await checkManager(session.user, false, isFreshSignIn);
            setLoading(false);
          }
          return;
        }

        if (session?.user) {
          await checkManager(session.user);
        } else {
          setUser(null);
          setIsManager(false);
        }
      }
    );

    initSession();

    return () => {
      listener?.subscription.unsubscribe();
      if (logoutTimeoutRef.current) clearTimeout(logoutTimeoutRef.current);
      clearInactivityTimer();
      teardownSessionLock();
    };
  }, []);

  const withWalkInCreation = async (callback) => {
    isCreatingWalkIn.current = true;
    try {
      return await callback();
    } finally {
      isCreatingWalkIn.current = false;
    }
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  // `options.silent` is for pages that already told the manager why
  // they're being logged out (e.g. right after a password/email change) —
  // it skips the generic logout toast entirely instead of showing a
  // second, redundant one.
  const logout = async (fromInactivity = false, options = {}) => {
    const { silent = false } = options;
    clearInactivityTimer();
    if (silent) {
      isSilentLogoutRef.current = true;
    } else {
      isManualLogout.current = !fromInactivity;
      if (fromInactivity) {
        isInactiveLogoutRef.current = true;
      }
    }
    if (managerIdRef.current && browserSessionIdRef.current) {
      await releaseManagerSessionClaim(managerIdRef.current, browserSessionIdRef.current);
    }
    teardownSessionLock();
    localStorage.removeItem('supabase.auth.token');
    sessionStorage.removeItem('supabase.auth.token');
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, initializing, isManager, login, logout, withWalkInCreation, sessionConflictMessage, clearSessionConflictMessage, markFreshLoginAttempt }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
