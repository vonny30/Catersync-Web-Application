// src/utils/bulkDeleteBookings.js
//
// Bulk-deletes bookings or short orders by id, for the Bookings and Short
// Orders lists. One implementation, because both pages need the same rule.
//
// BATCHED. Every id used to go into a single `.in('booking_id', [...])`, which
// is a URL. supabase-js warns past 8,000 characters (roughly 200 UUIDs) and
// servers reject far less than unlimited. A single page of ten never got near
// it; select-all spanning every matching record does, so the delete now works
// through the ids in batches.
//
// CHECKED. The child deletes used to discard their result. `payment` references
// `booking` ON DELETE RESTRICT, so a failed payment delete makes the booking
// delete fail on the foreign key and the manager saw only a generic error.
// (`booking_equipment` and `vehicle_assign` cascade, but are still deleted
// explicitly and checked, as the page always did.)
//
// Each batch removes its child rows first, then its bookings, and the first
// failure stops everything. A booking delete that removes nothing is also a
// failure: Supabase returns no error when RLS blocks a delete.
//
// Throws an Error carrying `userMessage` (how many were deleted, where it
// stopped) and `deleted`. Returns the number of bookings deleted.
import { supabase } from '../supabase';

export const BULK_DELETE_BATCH_SIZE = 100;

const CHILD_LABELS = {
  payment: 'payments',
  booking_equipment: 'equipment assignments',
  vehicle_assign: 'vehicle assignments',
};

export async function bulkDeleteBookings(ids, { childTables = [], noun = 'booking', client = supabase } = {}) {
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  let deleted = 0;

  const stop = (step, cause, childrenAlreadyRemoved) => {
    const remaining = ids.length - deleted;
    const note = childrenAlreadyRemoved
      ? ` Some of that batch's ${childrenAlreadyRemoved} may already have been removed.`
      : '';
    const message = `Deleted ${deleted} of ${plural(ids.length)}, then stopped while ${step}. The remaining ${plural(remaining)} were not deleted.${note}`;
    const failure = new Error(message, { cause: cause || undefined });
    failure.userMessage = message;
    failure.deleted = deleted;
    return failure;
  };

  const listed = (labels) => (labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels[0] || '');

  for (let start = 0; start < ids.length; start += BULK_DELETE_BATCH_SIZE) {
    const batch = ids.slice(start, start + BULK_DELETE_BATCH_SIZE);
    const removedChildren = [];

    for (const table of childTables) {
      const { error } = await client.from(table).delete().in('booking_id', batch);
      if (error) {
        throw stop(`removing their ${CHILD_LABELS[table] || table}`, error, listed(removedChildren));
      }
      removedChildren.push(CHILD_LABELS[table] || table);
    }

    const { error, count } = await client.from('booking').delete({ count: 'exact' }).in('booking_id', batch);
    if (error) throw stop(`deleting the ${noun}s themselves`, error, listed(removedChildren));
    if (!count) {
      throw stop(`deleting the ${noun}s themselves (the database removed none — this account may not be allowed to)`, null, listed(removedChildren));
    }
    deleted += count;
  }

  return deleted;
}
