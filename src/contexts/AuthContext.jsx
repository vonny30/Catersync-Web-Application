// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const isCreatingWalkIn = useRef(false);
  const inactivityTimerRef = useRef(null);
  const retryCount = useRef(0);
  const maxRetries = 2;
  const logoutTimeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const isInactiveLogoutRef = useRef(false);

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
        toast.error('You have been logged out due to inactivity.', { duration: 4000 });
        logout();
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

  const checkManager = async (authUser, isRetry = false) => {
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

      if (manager) {
        setUser(authUser);
        setIsManager(true);
        retryCount.current = 0;
        const rememberMe = localStorage.getItem('rememberMe') === 'true';
        if (!rememberMe) resetInactivityTimer();
        return true;
      } else {
        await supabase.auth.signOut();
        setUser(null);
        setIsManager(false);
        return false;
      }
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
        return checkManager(authUser, true);
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

  // Handle tab/browser close (only when rememberMe is false)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const rememberMe = localStorage.getItem('rememberMe') === 'true';
      if (!rememberMe && user) {
        supabase.auth.signOut();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

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
      }
    };

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event);

        if (event === 'SIGNED_OUT') {
          if (user && !isInactiveLogoutRef.current) {
            toast.error('Session expired. Please log in again.', { duration: 4000 });
          }
          isInactiveLogoutRef.current = false;
          clearInactivityTimer();
          if (logoutTimeoutRef.current) clearTimeout(logoutTimeoutRef.current);
          logoutTimeoutRef.current = setTimeout(() => {
            setUser(null);
            setIsManager(false);
            setLoading(false);
          }, 500);
          return;
        }

        if (event === 'TOKEN_REFRESHED') {
          retryCount.current = 0;
          if (session?.user) {
            setLoading(true);
            await checkManager(session.user);
            setLoading(false);
          }
          return;
        }

        if (event === 'SIGNED_IN') {
          if (session?.user) {
            setLoading(true);
            await checkManager(session.user);
            setLoading(false);
          }
          return;
        }

        if (session?.user) {
          setLoading(true);
          await checkManager(session.user);
          setLoading(false);
        } else {
          setUser(null);
          setIsManager(false);
          setLoading(false);
        }
      }
    );

    initSession();

    return () => {
      listener?.subscription.unsubscribe();
      if (logoutTimeoutRef.current) clearTimeout(logoutTimeoutRef.current);
      clearInactivityTimer();
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

  const logout = async () => {
    clearInactivityTimer();
    await supabase.auth.signOut();
    setUser(null);
    setIsManager(false);
    setLoading(false);
    toast.success('Logged out successfully');
  };

  return (
    <AuthContext.Provider value={{ user, loading, isManager, login, logout, withWalkInCreation }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);