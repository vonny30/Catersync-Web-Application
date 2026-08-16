// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export { supabaseUrl };
export const supabaseAnonKey = supabaseKey;

console.log("Supabase URL is:", supabaseUrl);
console.log("Supabase Key is:", supabaseKey ? "Found!" : "Missing!");

// Auth token lives in localStorage (not sessionStorage) so every tab of
// the same browser shares ONE real login — opening a second tab picks up
// the existing session instead of forcing a separate login, matching how
// Facebook/Gmail-style apps behave. Different browsers/profiles/devices
// still get their own localStorage, so cross-device session detection
// (see src/utils/managerSession.js) is unaffected.
const customStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key); // clean up any pre-migration tokens
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