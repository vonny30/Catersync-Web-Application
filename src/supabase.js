import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("Supabase URL is:", supabaseUrl);
console.log("Supabase Key is:", supabaseKey ? "Found!" : "Missing!");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // ✅ Use sessionStorage – session is cleared when the tab is closed
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});