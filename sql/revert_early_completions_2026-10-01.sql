-- =====================================================================
-- Revert the four bookings the Operations Manager app completed early
-- (found in the 1 Oct 2026 run-through; the app is now blocked from doing
-- this by sql/ops_app_completion_guards_2026-10-01.sql).
--
-- BKG-110, BKG-111, BKG-116: event still ahead and unpaid -> Confirmed,
--   equipment back to "not returned", vehicle runs back to Scheduled.
-- BKG-117: event happened on 26 Sep, so its equipment return and runs were
--   real and stay as they are; only the status goes back to Confirmed,
--   because ₱18,000 is still owed.
--
-- trg_block_lapsed_acceptance refuses Confirmed on a past event unless the
-- change is a manager override (BKG-117), so the transaction sets that.
-- Applied 1 Oct 2026 at Vaughn's request.
-- =====================================================================
begin;

select set_config('app.status_source', 'Manager override', true);

update public.booking
set booking_status = 'Confirmed', status_order = 3, completed_at = null
where booking_number in ('BKG-110', 'BKG-111', 'BKG-116', 'BKG-117')
  and booking_status = 'Completed';

update public.booking_equipment
set returned = false, returned_quantity = 0, returned_at = null, return_checked_at = null
where booking_id in (select booking_id from public.booking
                     where booking_number in ('BKG-110', 'BKG-111', 'BKG-116'));

update public.vehicle_assign
set assignment_status = 'Scheduled'
where booking_id in (select booking_id from public.booking
                     where booking_number in ('BKG-110', 'BKG-111', 'BKG-116'))
  and assignment_status = 'Completed';

commit;
