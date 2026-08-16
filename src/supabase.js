// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export { supabaseUrl };
export const supabaseAnonKey = supabaseKey;

console.log("Supabase URL is:", supabaseUrl);
console.log("Supabase Key is:", supabaseKey ? "Found!" : "Missing!");

// Auth token lives in sessionStorage so each browser TAB is its own
// login — combined with the single-active-session lock in
// src/utils/managerSession.js, this means only one tab/device can be
// signed in at a time anywhere, for the strictest, simplest security.
const customStorage = {
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => {
    localStorage.removeItem(key); // clean up any leftover tokens
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});