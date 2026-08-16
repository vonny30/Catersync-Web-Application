// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import {
  claimManagerSession,
  verifyOrReclaimManagerSession,
  releaseManagerSessionClaim,
  releaseManagerSessionClaimBeacon,
  subscribeManagerSession,
  peekManagerSessionConflict,
  registerOpenTab,
  unregisterOpenTab,
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
  // Set when a fresh login detects the account is already active on
  // another browser/device — pauses the login until the person confirms
  // they want to take over (instead of silently kicking the other side).
  // Never fires for a second tab of the SAME browser — those share one
  // session automatically (see managerSession.js).
  const [sessionConflict, setSessionConflict] = useState(null);
  const pendingManagerIdRef = useRef(null);
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

  // Latest session (for the access token used by the tab-close beacon).
  const sessionRef = useRef(null);
  // Identifies which manager / tab-session this browser tab currently owns.
  const managerIdRef = useRef(null);
  const tabSessionIdRef = useRef(null);
  const realtimeUnsubRef = useRef(null);
  // Periodically re-marks this tab as alive in the open-tabs registry so
  // other tabs of the same browser know not to release the shared claim
  // when THIS tab closes while others remain open.
  const tabHeartbeatRef = useRef(null);
  const TAB_HEARTBEAT_MS = 30 * 1000;

  const startTabHeartbeat = () => {
    registerOpenTab();
    if (tabHeartbeatRef.current) clearInterval(tabHeartbeatRef.current);
    tabHeartbeatRef.current = setInterval(registerOpenTab, TAB_HEARTBEAT_MS);
  };

  const stopTabHeartbeat = () => {
    if (tabHeartbeatRef.current) {
      clearInterval(tabHeartbeatRef.current);
      tabHeartbeatRef.current = null;
    }
  };

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
    managerIdRef.current = null;
    tabSessionIdRef.current = null;
    stopTabHeartbeat();
  };

  const handleKicked = (startedAt) => {
    if (isKickedRef.current) return; // already handling
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

    // ✅ Back button interception: triggers logout ONLY if returning to login page
    const handlePopState = () => {
      const isGoingToLogin = window.location.pathname === '/' || window.location.pathname === '/login';
      if (user && isGoingToLogin) {
        logout(false);
      }
    };

    window.addEventListener('popstate', handlePopState);

    // Best-effort: release the browser's claim on the account only when
    // THIS was the last open tab of this browser, so closing one of
    // several open tabs doesn't kick the tabs still open (same-browser
    // tabs share one claim now — see managerSession.js). A plain reload
    // doesn't lose the lock either way: verifyOrReclaimManagerSession
    // silently reclaims it on the next load if nobody else has logged in
    // during the gap. event.persisted means the page is going into the
    // back/forward cache, not actually closing, so skip in that case.
    const handlePageHide = (event) => {
      if (event.persisted) return;
      const wasLastTab = unregisterOpenTab();
      if (wasLastTab && managerIdRef.current && tabSessionIdRef.current && sessionRef.current?.access_token) {
        releaseManagerSessionClaimBeacon(
          managerIdRef.current,
          tabSessionIdRef.current,
          sessionRef.current.access_token
        );
      }
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, updateActivity);
      });
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pagehide', handlePageHide);
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
        // Before stealing anything, check whether the account is already
        // active elsewhere. If so, pause here and let the person logging
        // in confirm the takeover instead of silently kicking the other
        // side — see confirmTakeOverSession/cancelTakeOverSession below.
        const conflict = await peekManagerSessionConflict(manager.manager_id);
        if (conflict) {
          pendingManagerIdRef.current = manager.manager_id;
          setSessionConflict(conflict);
          return false;
        }
        const tabSessionId = await claimManagerSession(manager.manager_id);
        lockResult = { status: 'claimed', tabSessionId };
      } else {
        lockResult = await verifyOrReclaimManagerSession(manager.manager_id);
      }

      if (lockResult.status === 'kicked') {
        isKickedRef.current = true;
        await supabase.auth.signOut();
        return false;
      }

      teardownSessionLock();
      managerIdRef.current = manager.manager_id;
      tabSessionIdRef.current = lockResult.tabSessionId;
      realtimeUnsubRef.current = subscribeManagerSession(manager.manager_id, handleKicked);
      startTabHeartbeat();

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
        sessionRef.current = session;
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
        sessionRef.current = session;

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
                ? `This account was signed in from another browser or device at ${when}, so you were logged out here.`
                : 'This account was just signed in from another browser or device, so you were logged out here.',
              { id: AUTH_TOAST_ID, duration: 6000 }
            );
            isKickedRef.current = false;
            kickedAtRef.current = null;
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
            setLoading(true);
            await checkManager(session.user, false, true);
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
    if (managerIdRef.current && tabSessionIdRef.current) {
      await releaseManagerSessionClaim(managerIdRef.current, tabSessionIdRef.current);
    }
    teardownSessionLock();
    localStorage.removeItem('supabase.auth.token');
    sessionStorage.removeItem('supabase.auth.token');
    await supabase.auth.signOut();
  };

  // Called when the person logging in confirms they want to take over the
  // account from whatever browser/device currently holds it.
  const confirmTakeOverSession = async () => {
    const managerId = pendingManagerIdRef.current;
    if (!managerId) return;
    try {
      const tabSessionId = await claimManagerSession(managerId);
      teardownSessionLock();
      managerIdRef.current = managerId;
      tabSessionIdRef.current = tabSessionId;
      realtimeUnsubRef.current = subscribeManagerSession(managerId, handleKicked);
      startTabHeartbeat();

      const { data: { user: authUser } } = await supabase.auth.getUser();
      setUser(authUser);
      setIsManager(true);
      retryCount.current = 0;
      const rememberMe = localStorage.getItem('rememberMe') === 'true';
      if (!rememberMe) resetInactivityTimer();
    } finally {
      pendingManagerIdRef.current = null;
      setSessionConflict(null);
    }
  };

  // Called when the person logging in backs out instead — leaves the other
  // browser/device signed in untouched and cancels this login attempt.
  const cancelTakeOverSession = async () => {
    pendingManagerIdRef.current = null;
    setSessionConflict(null);
    isSilentLogoutRef.current = true; // Login.jsx shows its own message
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, initializing, isManager, login, logout, withWalkInCreation, sessionConflict, confirmTakeOverSession, cancelTakeOverSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
