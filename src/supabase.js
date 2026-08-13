// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("Supabase URL is:", supabaseUrl);
console.log("Supabase Key is:", supabaseKey ? "Found!" : "Missing!");

// In supabase.js
const customStorage = {
  getItem: (key) => {
    const useLocal = localStorage.getItem('rememberMe') === 'true';
    const storage = useLocal ? localStorage : sessionStorage;
    return storage.getItem(key);
  },
  setItem: (key, value) => {
    const useLocal = localStorage.getItem('rememberMe') === 'true';
    const storage = useLocal ? localStorage : sessionStorage;
    storage.setItem(key, value);
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};
// ✅ Use the custom storage adapter
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});