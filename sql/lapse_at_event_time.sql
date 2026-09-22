-- lapse_at_event_time.sql
--
-- NOT APPLIED. For Vaughn to run in the Supabase SQL editor.
--
-- A Pending or Approved booking now LAPSES THE MOMENT ITS EVENT TIME PASSES —
-- the date AND the time — instead of 12 hours later.
--
-- Why: f_accept_grace_hours() returned 12, so a request stayed acceptable for
-- 12 hours after its event time. SO-021 (Allen Smith, short order due 11:00 AM
-- on 22 Sep) could still be approved at 10:47 PM that night.
--
-- f_accept_grace_hours() is the one number both halves of the rule read:
--   * v_booking_money.is_lapsed / is_in_grace — what the app shows (no
--     Approve / Confirm, grey row, "Can't be approved — event date passed")
--   * trg_block_lapsed_acceptance — the database refusing the approval itself
-- so changing it here changes both at once. The app has no copy of the number.
--
-- Shared database: the customer mobile app does not approve or confirm
-- bookings, so nothing it does is refused by this.

create or replace function public.f_accept_grace_hours()
returns integer
language sql
immutable
set search_path to ''
as $function$ select 0; $function$;

-- Check: SO-021 should now read is_lapsed = true (its 11:00 AM time is past).
--   select b.booking_number, m.is_lapsed, m.is_in_grace
--   from public.booking b join public.v_booking_money m on m.booking_id = b.booking_id
--   where b.booking_number = 'SO-021';
