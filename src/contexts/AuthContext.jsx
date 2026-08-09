// src/contexts/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);

  const checkManager = async (authUser) => {
    try {
      if (window.isCreatingWalkIn) {
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await checkManager(session.user);
      } else {
        setLoading(false);
      }
    };

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

  // ❌ REMOVED beforeunload – reload does NOT log out.

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
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