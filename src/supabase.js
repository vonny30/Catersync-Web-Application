// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export { supabaseUrl };
export const supabaseAnonKey = supabaseKey;

console.log("Supabase URL is:", supabaseUrl);
console.log("Supabase Key is:", supabaseKey ? "Found!" : "Missing!");

// The auth token uses Supabase's default localStorage-backed storage —
// deliberately NOT overridden to sessionStorage. Storing it per-tab used
// to be how this app tried to enforce "one login at a time", but it broke
// in a much worse way than it fixed: duplicating/ctrl-clicking a tab
// copies sessionStorage, so both tabs would start out holding an
// IDENTICAL COPY of the same refresh token. Supabase rotates refresh
// tokens on every use (each one is single-use), so whichever tab
// refreshed first silently invalidated the other tab's copy — causing
// that tab to get randomly signed out with no relation to anything in
// this app's own code. The single-active-session rule is now enforced
// separately and correctly by manager.active_session_id (see
// src/utils/managerSession.js), which doesn't have this problem.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});