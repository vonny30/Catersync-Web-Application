// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    // 1. Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await checkManager(session.user);
      } else {
        setLoading(false);
      }
    };

    // 2. Listen for auth changes
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
    };
  }, []);

  // Check if user exists in manager table
  const checkManager = async (authUser) => {
    try {
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
        // Not a manager – sign out and clear state
        await supabase.auth.signOut();
        setUser(null);
        setIsManager(false);
      }
    } catch (error) {
      console.error('Error checking manager status:', error);
      setUser(null);
      setIsManager(false);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // The onAuthStateChange will handle setting user
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsManager(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isManager, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);