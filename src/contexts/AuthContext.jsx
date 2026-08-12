// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const isCreatingWalkIn = useRef(false);
  let timeoutId = null; // for safety timeout

  const checkManager = async (authUser) => {
    try {
      if (isCreatingWalkIn.current) {
        setLoading(false);
        return;
      }
      const { data: manager, error } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (error) throw error;

      if (manager) {
        setUser(authUser);
        setIsManager(true);
      } else {
        await supabase.auth.signOut();
        setUser(null);
        setIsManager(false);
      }
    } catch (error) {
      console.error('Error checking manager status:', error);
      setUser(null);
      setIsManager(false);
      // Sign out to clear invalid session
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };

  useEffect(() => {
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await checkManager(session.user);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Session error:', error);
        setLoading(false);
      }
    };

    // ⏱️ Safety timeout: force loading to false after 5 seconds
    timeoutId = setTimeout(() => {
      if (loading) {
        console.warn('Auth loading timeout – forcing loading to false');
        setLoading(false);
        if (timeoutId) clearTimeout(timeoutId);
      }
    }, 5000);

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          await checkManager(session.user);
        } else {
          setUser(null);
          setIsManager(false);
          setLoading(false);
        }
      }
    );

    getSession();

    return () => {
      listener?.subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
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
    await supabase.auth.signOut();
    setUser(null);
    setIsManager(false);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isManager, login, logout, withWalkInCreation }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);