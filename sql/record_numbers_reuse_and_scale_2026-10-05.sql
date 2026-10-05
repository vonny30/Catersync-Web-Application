-- =====================================================================
-- Record numbers: BKG- (package bookings), SO- (short orders) and EQP-
-- (equipment assignments). Applied 5 Oct 2026 at Vaughn's request.
--
-- 1. REUSE. The next number is the highest number in use plus one, so
--    deleting the newest record frees its number for the next one
--    (delete BKG-100 while BKG-099 is the next highest -> the next booking
--    is BKG-100 again). A record deleted from the middle leaves a gap;
--    numbers always rise with time, so a higher number is a newer record.
--    Before this, each prefix had its own sequence, which never goes back.
--
-- 2. NO LIMIT. The old functions used LPAD(n, 3), and LPAD also CUTS a
--    longer string to the given length: number 1000 came out as "100",
--    a duplicate. Numbers now keep at least three digits (BKG-007) and
--    grow past that (BKG-1000, BKG-10000, ...).
--
-- 3. SAFE AT THE SAME MOMENT. Two bookings saved at once (the web app and
--    the customer mobile app, say) would both read the same highest number.
--    A transaction-level advisory lock per prefix makes the second wait
--    until the first is saved, so it reads the new highest number.
--
-- 4. NO DUPLICATES, EVER. A unique index on each number column: the
--    database refuses a duplicate even if something bypasses the trigger.
--
-- 5. FAST AT ANY SIZE. An index on (prefix, numeric part) lets "highest
--    number" be read from the end of the index instead of scanning the
--    table, so saving a booking costs the same at 100 rows or 1,000,000.
--
-- Existing numbers are not changed. The old sequences are left in place
-- but no longer used.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Booking numbers: BKG-### for packages, SO-### for short orders
-- ---------------------------------------------------------------------
create or replace function public.set_booking_number()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_prefix text;
  v_next   bigint;
begin
  v_prefix := case new.booking_type
                when 'Package'     then 'BKG'
                when 'Short Order' then 'SO'
                else 'UNK'
              end;

  -- One booking of this kind numbered at a time (released at commit).
  perform pg_advisory_xact_lock(hashtext('public.booking.booking_number'), hashtext(v_prefix));

  select coalesce(max(substring(b.booking_number from '[0-9]+$')::bigint), 0) + 1
    into v_next
    from public.booking b
   where split_part(b.booking_number, '-', 1) = v_prefix;

  new.booking_number := v_prefix || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
  return new;
end;
$$;

create index if not exists booking_number_prefix_value_idx
  on public.booking (split_part(booking_number, '-', 1), (substring(booking_number from '[0-9]+$')::bigint));

create unique index if not exists booking_booking_number_key
  on public.booking (booking_number);

-- ---------------------------------------------------------------------
-- Equipment assignment numbers: EQP-###
-- ---------------------------------------------------------------------
create or replace function public.set_assignment_number()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.booking_equipment.assignment_number'), hashtext('EQP'));

  select coalesce(max(substring(e.assignment_number from '[0-9]+$')::bigint), 0) + 1
    into v_next
    from public.booking_equipment e
   where split_part(e.assignment_number, '-', 1) = 'EQP';

  new.assignment_number := 'EQP-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
  return new;
end;
$$;

create index if not exists booking_equipment_number_prefix_value_idx
  on public.booking_equipment (split_part(assignment_number, '-', 1), (substring(assignment_number from '[0-9]+$')::bigint));

create unique index if not exists booking_equipment_assignment_number_key
  on public.booking_equipment (assignment_number);

-- ---------------------------------------------------------------------
-- Follow-up, same day: the numbering functions must see EVERY row.
-- Run as the person saving, a customer booking from the mobile app sees
-- only their own bookings (row-level security), takes a number already
-- used by someone else, and the unique index refuses their booking.
-- SECURITY DEFINER runs the functions as their owner, which reads the
-- whole table. They only set the number; search_path is pinned to ''.
-- Checked as a real customer account: BKG-139 / SO-032 saved, and the
-- customer still sees only their own bookings.
-- ---------------------------------------------------------------------
alter function public.set_booking_number() security definer;
alter function public.set_assignment_number() security definer;
