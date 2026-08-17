// src/utils/verifyPassword.js
//
// Re-verifies the manager's own password (used before permanent deletes)
// WITHOUT touching the app's real Supabase session. Calling
// supabase.auth.signInWithPassword() on the shared client would fire a
// real SIGNED_IN event, which this app's single-tab session-lock logic
// (see AuthContext.jsx / utils/managerSession.js) treats as a fresh
// login — re-claiming the session, tearing down and resubscribing
// realtime channels, etc. That churn is exactly what was leaving list
// pages showing stale data after a delete until a manual refresh.
//
// A throwaway client with persistSession/autoRefreshToken disabled has
// its own isolated in-memory auth state, so signing in on it to check a
// password never emits an event the main app's listener can see.
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../supabase';

let verifyClient = null;

function getVerifyClient() {
  if (!verifyClient) {
    verifyClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return verifyClient;
}

/**
 * Returns true if the password is correct for this email, false otherwise.
 * Throws only on unexpected (non-auth) errors, e.g. a network failure.
 */
export async function verifyPassword(email, password) {
  const client = getVerifyClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // Wrong password (or any credential-related rejection) — not a bug,
    // just an incorrect answer to relay back to the caller.
    return false;
  }
  // Immediately drop whatever session this throwaway client just created —
  // it's not persisted and isn't the app's real session, but there's no
  // reason to keep it in memory either.
  await client.auth.signOut();
  return true;
}
