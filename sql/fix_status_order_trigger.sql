-- sql/fix_status_order_trigger.sql
--
-- APPLIED to the live database on 5 Sep 2026.
--
-- `booking.status_order` exists only to give the Bookings and Short Orders list
-- pages a sortable column, because PostgREST cannot ORDER BY a CASE expression.
-- The app's authority for its values is STATUS_ORDER in
-- src/utils/bookingStatus.js.
--
-- A trigger has been writing that column all along:
--
--   CREATE TRIGGER set_status_order BEFORE INSERT OR UPDATE OF booking_status
--     ON public.booking FOR EACH ROW EXECUTE FUNCTION update_status_order();
--
-- and its mapping predated the Confirmed status:
--
--                trigger (old)   app
--   Pending            1          1
--   Approved           2          2
--   Confirmed      ELSE -> 5      3     <-- no branch of its own
--   Completed          3          4
--   Cancelled          4          6
--   Rejected           5          5
--
-- Four of six disagreed, and being BEFORE INSERT the trigger overwrote whatever
-- the app supplied — including in the same statement that set booking_status.
-- The visible symptom: change a booking's status and it sorts into the wrong
-- group until the list reloads and the app's self-heal repairs it.
--
-- This is the defect src/utils/bookingStatus.js already described and blamed on
-- stale rows and the mobile app: "three Confirmed bookings carried status_order
-- 5 (Rejected's slot) and a Cancelled one carried 4 (Completed's)". Those are
-- this trigger's values for those two statuses.
--
-- Caught live while applying this fix: BKG-105 was cancelled through the web app
-- minutes beforehand. The app wrote 6, the old trigger overwrote it with 4.

create or replace function public.update_status_order()
returns trigger
language plpgsql
as $fn$
BEGIN
  -- Must match STATUS_ORDER in src/utils/bookingStatus.js exactly.
  NEW.status_order := CASE NEW.booking_status
    WHEN 'Pending'   THEN 1
    WHEN 'Approved'  THEN 2
    WHEN 'Confirmed' THEN 3
    WHEN 'Completed' THEN 4
    WHEN 'Rejected'  THEN 5
    WHEN 'Cancelled' THEN 6
    -- An unrecognised status belongs at the top of the work queue, where
    -- someone will see it. The old ELSE filed it with the rejections.
    ELSE 1
  END;
  RETURN NEW;
END;
$fn$;

-- Repair rows written under the old mapping. Touches status_order only, so the
-- trigger (scoped to UPDATE OF booking_status) does not fire on it.
update booking set status_order = case booking_status
    when 'Pending'   then 1
    when 'Approved'  then 2
    when 'Confirmed' then 3
    when 'Completed' then 4
    when 'Rejected'  then 5
    when 'Cancelled' then 6
  end
where status_order is distinct from (case booking_status
    when 'Pending'   then 1
    when 'Approved'  then 2
    when 'Confirmed' then 3
    when 'Completed' then 4
    when 'Rejected'  then 5
    when 'Cancelled' then 6
  end);

-- ---------------------------------------------------------------------------
-- Verification run on 5 Sep 2026, all inside transactions that were rolled back
-- ---------------------------------------------------------------------------
-- UPDATE path — all five transitions produced the app's value:
--   Approved 2 · Confirmed 3 · Completed 4 · Rejected 5 · Cancelled 6
-- INSERT path — a fresh row in each of the six statuses produced 1..6 in order.
-- Live data afterwards: 0 rows disagree with the app's map.
--
-- select booking_status, status_order, count(*) from booking group by 1,2 order by 2;

-- ---------------------------------------------------------------------------
-- REVERT — the exact definition this replaced
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.update_status_order()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--   NEW.status_order := CASE NEW.booking_status
--     WHEN 'Pending'   THEN 1
--     WHEN 'Approved'  THEN 2
--     WHEN 'Completed' THEN 3
--     WHEN 'Cancelled' THEN 4
--     WHEN 'Rejected'  THEN 5
--     ELSE 5
--   END;
--   RETURN NEW;
-- END;
-- $function$
--
-- Reverting restores the drift. The self-heal in Bookings.jsx keeps the list
-- readable either way, which is why this went unnoticed for so long.
