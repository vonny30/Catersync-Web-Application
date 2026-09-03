// src/utils/currentManager.js
//
// Who is doing this? — answerable from anywhere, including modules that are
// not React components.
//
// `vehicle_assign.manager_id` is a foreign key to `manager.manager_id` that
// nothing has ever written: all 24 rows are null. Capstone §3.6 commits the
// system to a record of "who has done what and when", and dispatch is exactly
// the kind of act that needs one — but the column sat empty because the two
// places that insert assignments could not conveniently reach the signed-in
// manager. AuthContext knows the id (it fetches it to claim the session lock)
// and keeps it in a ref it does not expose; `utils/vehicle.js` is a plain
// module and cannot read React context at all.
//
// So the lookup lives here, where every caller can reach it.
//
// NOTE the two different ids. `auth.users.id` is what Supabase auth returns;
// `manager.manager_id` is what the foreign key points at. They are not the
// same value, and writing the wrong one produces a constraint error rather
// than a silently wrong row — which is the better failure, but still one to
// avoid by reading this comment.
import { supabase } from '../supabase';

// One manager per browser session, and the mapping cannot change while signed
// in, so this is resolved once. Keyed by auth user id so switching accounts
// within a tab cannot inherit the previous manager's attribution.
let cache = { userId: null, managerId: null };

/**
 * The signed-in manager's `manager_id`, or null.
 *
 * Returns null rather than throwing on every failure path — no session, no
 * matching manager row, a network error. `manager_id` is nullable, and
 * attribution is worth having but is NOT worth refusing to dispatch a vehicle
 * over. A missing attribution is a gap in the log; a failed insert is a van
 * that never got assigned.
 */
export async function getCurrentManagerId() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;

    if (cache.userId === userId && cache.managerId) return cache.managerId;

    const { data, error } = await supabase
      .from('manager')
      .select('manager_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data?.manager_id) {
      // Worth seeing in the console — it means dispatches are being recorded
      // with no author — but not worth interrupting the manager for.
      console.warn('Could not resolve manager_id for attribution:', error || 'no manager row');
      return null;
    }

    cache = { userId, managerId: data.manager_id };
    return data.manager_id;
  } catch (err) {
    console.warn('Could not resolve manager_id for attribution:', err);
    return null;
  }
}

/** Drop the cached mapping. Call on sign-out so the next manager re-resolves. */
export function clearCurrentManagerCache() {
  cache = { userId: null, managerId: null };
}
