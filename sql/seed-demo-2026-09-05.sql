-- sql/seed-demo-2026-09-05.sql
--
-- Demo data for the 1st Increment defence. Written and RUN on 5 Sep 2026,
-- after the database was reduced to a single booking, which left Reports,
-- Menu Performance and Booking Summary with nothing to show.
--
-- Every row here exists to make one panel comment demonstrable. Each block is
-- keyed to docs/panel-revisions-2026-05-29.md.
--
-- SAFE TO RE-RUN. It removes only the rows it created — matched on the venue
-- strings below, which exist nowhere else — and never touches BKG-105,
-- customers, packages, menu items, equipment or vehicles.
--
-- ---------------------------------------------------------------------------
-- THREE TRIGGERS SHAPE WHAT THIS SCRIPT CAN DO. Found the hard way, 5 Sep.
-- ---------------------------------------------------------------------------
--
--   trigger_set_booking_number   BEFORE INSERT ON booking
--   trg_set_assignment_number    BEFORE INSERT ON booking_equipment
--   set_status_order             BEFORE INSERT OR UPDATE OF booking_status
--                                ON booking
--
-- 1. A booking_number supplied by an INSERT is DISCARDED. The trigger assigns
--    the next number in sequence. So this script cannot choose its own refs,
--    and every dependent insert is keyed on `venue` instead. Same for
--    booking_equipment.assignment_number.
--
-- 2. `set_status_order` writes a mapping that PREDATES the Confirmed status
--    and disagrees with utils/bookingStatus.js on four of six values:
--
--      trigger:  Pending 1  Approved 2  Completed 3  Cancelled 4  Rejected 5
--                Confirmed -> ELSE -> 5
--      app:      Pending 1  Approved 2  Confirmed 3  Completed 4
--                Rejected 5  Cancelled 6
--
--    So §5 below re-writes status_order after the insert. That UPDATE touches
--    only status_order, not booking_status, so the trigger does not fire on it
--    and the correction sticks — which is also why the app's own self-heal
--    (Bookings.jsx) works. See docs/panel-revisions-2026-05-29.md for the
--    standing defect this trigger causes.
--
-- Run in the Supabase SQL editor, top to bottom.

begin;

-- ---------------------------------------------------------------------------
-- 0. Remove any previous run of this seed
-- ---------------------------------------------------------------------------
create temporary table seeded_venues (venue text primary key) on commit drop;
insert into seeded_venues values
  ('Silliman University Gymnasium'),
  ('Bethel Guest House Function Room'),
  ('Sta. Monica Beach Club'),
  ('Villa Amanda, Valencia'),
  ('Silliman University Ballroom'),
  ('Casa Nena Events Place'),
  ('Dumaguete Convention Centre'),
  ('Private residence, Bantayan'),
  ('Rizal Boulevard Function Hall'),
  ('Hibbard Avenue Garden'),
  ('Barangay Daro Covered Court'),
  ('Piapi Beach Road'),
  ('Bantayan, pickup at the kitchen');

delete from payment           where booking_id in (select booking_id from booking where venue in (select venue from seeded_venues));
delete from booking_equipment where booking_id in (select booking_id from booking where venue in (select venue from seeded_venues));
delete from vehicle_assign    where booking_id in (select booking_id from booking where venue in (select venue from seeded_venues));
delete from booking           where venue in (select venue from seeded_venues);

-- ---------------------------------------------------------------------------
-- 1. Bookings — all six statuses
-- ---------------------------------------------------------------------------
-- PR-10  something to sort: every status, with varied book_datetime.
-- PR-15  one Confirmed event inside the next 7 days (Sta. Monica, 11 Sep).
-- PR-35  two events in the FOLLOWING month (3 Oct, 17 Oct, 5 Oct).
--
-- menu_selections is polymorphic: an OBJECT keyed by category_id for a package,
-- an ARRAY of {menu_item_id, quantity} for a short order. Seeding the wrong
-- shape is exactly the mistake docs/field-alignment.md §2 warns about.
-- Granite has no categories, so its bookings correctly carry {}.
--
-- Customers are picked by position, so this runs against whatever rows exist.

with cust as (
  select customer_id, row_number() over (order by customer_id) as rn from customer
),
seed (btype, pkg, pax, venue, event_at, booked_at, status, total, delivery, sel, note, rn) as (values
  ('Package','bronze'::text, 80,'Silliman University Gymnasium','2026-07-12 11:00+08','2026-06-20 09:15+08','Completed',20000.00,  0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"136debf9-b20f-4580-900f-e6df8f318cf9","f55b66a6-bf4e-4885-906e-fbc6e3e6657d":"2cb11bac-3b43-4f7c-8c4b-024dade679bc"}','Graduation lunch.',1),
  ('Package','silver',       60,'Bethel Guest House Function Room','2026-08-08 18:00+08','2026-07-18 14:40+08','Completed',21000.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"e86b0c96-e7a0-4082-a841-8effc326c7f0","03fe7ae3-add6-4639-a422-5cebbf2c8568":"8173bb3b-2a0d-4258-b268-963606263b30","7e3f4357-ee9a-4268-a26a-95458022b6f7":"10f0d8f7-b1fd-46cc-a830-13710a8160d6"}','Paid in three instalments.',2),
  ('Package','gold',        100,'Sta. Monica Beach Club','2026-09-11 12:00+08','2026-08-22 10:05+08','Confirmed',30000.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"136debf9-b20f-4580-900f-e6df8f318cf9","03fe7ae3-add6-4639-a422-5cebbf2c8568":"35a9f8dc-59fa-4394-bb89-158ee333f3d6","3800c98c-eeab-4d3f-a091-0c3e697779f2":"a05abe48-4616-4b6b-926b-01efc681a2cd","7e3f4357-ee9a-4268-a26a-95458022b6f7":"383915b0-dfa8-4108-a426-32ac69b25b26","f55b66a6-bf4e-4885-906e-fbc6e3e6657d":"2cb11bac-3b43-4f7c-8c4b-024dade679bc"}','Wedding reception.',3),
  ('Package','granite',      45,'Villa Amanda, Valencia','2026-09-19 17:00+08','2026-08-28 16:20+08','Confirmed',5000.00,0.00,'{}','Decorations only.',4),
  ('Package','bronze',      120,'Silliman University Ballroom','2026-10-03 11:00+08','2026-09-01 08:30+08','Approved',30000.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"e86b0c96-e7a0-4082-a841-8effc326c7f0","f55b66a6-bf4e-4885-906e-fbc6e3e6657d":"2cb11bac-3b43-4f7c-8c4b-024dade679bc"}','Proof submitted, not verified.',5),
  ('Package','silver',       50,'Casa Nena Events Place','2026-10-17 18:00+08','2026-09-04 19:10+08','Pending',17500.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"136debf9-b20f-4580-900f-e6df8f318cf9","03fe7ae3-add6-4639-a422-5cebbf2c8568":"8173bb3b-2a0d-4258-b268-963606263b30","7e3f4357-ee9a-4268-a26a-95458022b6f7":"6e6cecc6-1811-49f5-8e31-4a6ac139db40"}','Awaiting review.',6),
  ('Package','gold',         70,'Dumaguete Convention Centre','2026-09-26 12:00+08','2026-08-14 11:00+08','Cancelled',21000.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"136debf9-b20f-4580-900f-e6df8f318cf9","03fe7ae3-add6-4639-a422-5cebbf2c8568":"8173bb3b-2a0d-4258-b268-963606263b30","3800c98c-eeab-4d3f-a091-0c3e697779f2":"443ad1d2-012f-47de-a0dc-bca07df7db40","7e3f4357-ee9a-4268-a26a-95458022b6f7":"10f0d8f7-b1fd-46cc-a830-13710a8160d6","f55b66a6-bf4e-4885-906e-fbc6e3e6657d":"2cb11bac-3b43-4f7c-8c4b-024dade679bc"}','Cancelled early; refunded in full.',7),
  ('Package','bronze',       55,'Private residence, Bantayan','2026-09-30 18:00+08','2026-08-30 20:45+08','Rejected',13750.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"e86b0c96-e7a0-4082-a841-8effc326c7f0","f55b66a6-bf4e-4885-906e-fbc6e3e6657d":"2cb11bac-3b43-4f7c-8c4b-024dade679bc"}','Date already fully booked.',8),
  ('Package','granite',      30,'Rizal Boulevard Function Hall','2026-09-24 15:00+08','2026-08-31 13:25+08','Confirmed',5000.00,0.00,'{}','Equipment not yet assigned.',9),
  ('Package','silver',       40,'Hibbard Avenue Garden','2026-09-14 18:00+08','2026-08-19 09:00+08','Cancelled',14000.00,0.00,'{"14c99363-c211-46b8-ae7b-82e6344a1e0a":"136debf9-b20f-4580-900f-e6df8f318cf9","03fe7ae3-add6-4639-a422-5cebbf2c8568":"35a9f8dc-59fa-4394-bb89-158ee333f3d6","7e3f4357-ee9a-4268-a26a-95458022b6f7":"383915b0-dfa8-4108-a426-32ac69b25b26"}','Cancelled inside the 3-day window; downpayment retained.',10),
  ('Short Order',null,        0,'Barangay Daro Covered Court','2026-08-20 10:00+08','2026-08-15 17:30+08','Completed',11500.00,500.00,'[{"menu_item_id":"136debf9-b20f-4580-900f-e6df8f318cf9","quantity":3},{"menu_item_id":"383915b0-dfa8-4108-a426-32ac69b25b26","quantity":1},{"menu_item_id":"a05abe48-4616-4b6b-926b-01efc681a2cd","quantity":3}]','Delivered.',11),
  ('Short Order',null,        0,'Piapi Beach Road','2026-09-12 09:00+08','2026-09-02 12:00+08','Confirmed',7900.00,500.00,'[{"menu_item_id":"8173bb3b-2a0d-4258-b268-963606263b30","quantity":2},{"menu_item_id":"2cb11bac-3b43-4f7c-8c4b-024dade679bc","quantity":1},{"menu_item_id":"383915b0-dfa8-4108-a426-32ac69b25b26","quantity":1}]','Delivery run.',12),
  ('Short Order',null,        0,'Bantayan, pickup at the kitchen','2026-10-05 10:00+08','2026-09-03 15:00+08','Pending',5000.00,0.00,'[{"menu_item_id":"6e6cecc6-1811-49f5-8e31-4a6ac139db40","quantity":2}]','Customer will collect.',13)
)
insert into booking (
  booking_type, book_datetime, venue, event_datetime, pax_count, customer_id,
  package_id, booking_status, total_amount, delivery_fee, menu_selections, notes, is_read
)
select s.btype, s.booked_at::timestamptz, s.venue, s.event_at::timestamptz, s.pax, c.customer_id,
  case s.pkg
    when 'bronze'  then 'f9c0ac03-15ef-4964-9563-3f56856b629b'::uuid
    when 'silver'  then 'ff62b5b7-8676-4b38-bcdb-e059fc163ff4'::uuid
    when 'gold'    then '5d127604-0bea-4ea2-976d-b25bb8976386'::uuid
    when 'granite' then '4ede19fb-ae6e-4926-9b1d-24c6fe81b51c'::uuid
    else null
  end,
  s.status, s.total, s.delivery, s.sel::jsonb, s.note, s.status <> 'Pending'
from seed s
join cust c on c.rn = ((s.rn - 1) % (select count(*) from cust)) + 1;

-- ---------------------------------------------------------------------------
-- 2. Payments
-- ---------------------------------------------------------------------------
-- PR-02  all three methods appear: Cash, GCash, Bank Transfer.
-- PR-03  Bethel has THREE payments, so the middle one displays as
--        "Partial payment" — the derived third term. Nothing shows it without
--        a booking that has more than two.
-- PR-04  Silliman Ballroom sits in Pending Verification, so the Awaiting
--        Verification card is not empty and Verify / Reject can be demoed.
-- PR-16  Rizal Boulevard keeps a verified balance, so deleting it names money.
-- PR-19  the Fully Paid tab count and its records agree.
-- PR-23  Dumaguete Convention Centre carries a refund as its own NEGATIVE row.
-- PR-38  Hibbard Avenue was cancelled with the downpayment KEPT and no refund,
--        which is what puts a figure on the retained-from-cancellations line.
--
-- Every first payment is at least 50% of the total, matching the rule the
-- record-payment form enforces. pay_proof is NOT NULL and no file was uploaded,
-- so it carries a readable marker rather than a URL that would 404.

insert into payment (booking_id, customer_id, amount_paid, pay_installment, pay_method, pay_status, pay_proof, pay_datetime, remarks)
select b.booking_id, b.customer_id, v.amt, v.inst, v.method, v.status,
       'seed://demo-2026-09-05/no-proof-file', v.paid_at::timestamptz, v.remarks
from (values
  ('Silliman University Gymnasium',     10000.00, 1, 'GCash',         'Downpayment',          '2026-07-02 10:00+08', null::text),
  ('Silliman University Gymnasium',     10000.00, 2, 'Cash',          'Fully Paid',           '2026-07-12 09:30+08', null),
  ('Bethel Guest House Function Room',  11000.00, 1, 'Bank Transfer', 'Downpayment',          '2026-07-25 11:20+08', null),
  ('Bethel Guest House Function Room',   5000.00, 2, 'GCash',         'Downpayment',          '2026-08-01 15:45+08', 'Second instalment.'),
  ('Bethel Guest House Function Room',   5000.00, 3, 'Cash',          'Fully Paid',           '2026-08-08 16:00+08', 'Balance settled on the day.'),
  ('Sta. Monica Beach Club',            15000.00, 1, 'Bank Transfer', 'Downpayment',          '2026-09-01 09:10+08', null),
  ('Villa Amanda, Valencia',             5000.00, 1, 'GCash',         'Fully Paid',           '2026-09-03 14:00+08', null),
  ('Silliman University Ballroom',      15000.00, 1, 'GCash',         'Pending Verification', '2026-09-04 18:20+08', 'Proof uploaded from the mobile app.'),
  ('Dumaguete Convention Centre',       10500.00, 1, 'GCash',         'Downpayment',          '2026-08-28 10:00+08', null),
  ('Dumaguete Convention Centre',      -10500.00, 2, 'GCash',         'Refunded',             '2026-08-31 11:00+08', 'Cancelled outside the 3-day window; refunded in full.'),
  ('Rizal Boulevard Function Hall',      2500.00, 1, 'Cash',          'Downpayment',          '2026-09-02 13:00+08', null),
  ('Hibbard Avenue Garden',              7000.00, 1, 'Cash',          'Downpayment',          '2026-09-01 10:30+08', 'Retained on cancellation inside the 3-day window.'),
  ('Barangay Daro Covered Court',       11500.00, 1, 'Cash',          'Fully Paid',           '2026-08-20 09:45+08', null),
  ('Piapi Beach Road',                   4000.00, 1, 'GCash',         'Downpayment',          '2026-09-03 12:30+08', null)
) as v(venue, amt, inst, method, status, paid_at, remarks)
join booking b on b.venue = v.venue;

-- ---------------------------------------------------------------------------
-- 3. Equipment assignments
-- ---------------------------------------------------------------------------
-- PR-05/06 real per-date commitments for the Availability tab to subtract.
-- PR-07/25/26 the identity holds on every row: total = usable + out of service,
--        available = usable - committed on the date. The Centerpiece Vase's
--        2 damaged units stay out of usable and must never read as spare.
-- PR-27  Rizal Boulevard is deliberately left with NO rows, so it renders as
--        "Estimated from package (not yet manually assigned)" — the state the
--        panel asked about on BK-067, which no longer exists in the data.
--
-- Quantities follow the app's own allocation: 1 chair and 1 chafing dish per
-- guest, 1 buffet table per 6. Nothing exceeds usable stock on its date.
-- assignment_number is assigned by trigger and must not be supplied.

insert into booking_equipment (booking_id, equipment_id, quantity, assigned_at, returned, returned_at)
select b.booking_id, v.eq::uuid, v.qty, b.book_datetime, v.returned,
       case when v.returned then b.event_datetime + interval '20 hours' else null end
from (values
  ('Silliman University Gymnasium',    '9191f31e-ef89-4a03-a87f-5da30145abe5', 80, true),
  ('Silliman University Gymnasium',    '80a7c9ae-e821-42bc-bb4e-b1b4a2d66433', 80, true),
  ('Silliman University Gymnasium',    '64cabf9a-b7f2-4387-b6fe-c94bece8e84f', 14, true),
  ('Bethel Guest House Function Room', '9191f31e-ef89-4a03-a87f-5da30145abe5', 60, true),
  ('Bethel Guest House Function Room', '80a7c9ae-e821-42bc-bb4e-b1b4a2d66433', 60, true),
  ('Bethel Guest House Function Room', '64cabf9a-b7f2-4387-b6fe-c94bece8e84f', 10, true),
  ('Sta. Monica Beach Club',           '9191f31e-ef89-4a03-a87f-5da30145abe5',100, false),
  ('Sta. Monica Beach Club',           '80a7c9ae-e821-42bc-bb4e-b1b4a2d66433',100, false),
  ('Sta. Monica Beach Club',           '64cabf9a-b7f2-4387-b6fe-c94bece8e84f', 17, false),
  ('Sta. Monica Beach Club',           '5aa3d1f3-353e-497a-9b6d-ef69552da0f2',100, false),
  ('Villa Amanda, Valencia',           'b86c2dff-48c8-4aaf-ae9e-6b95ffc3b483',  4, false),
  ('Villa Amanda, Valencia',           '898af7cf-06d9-49d8-9961-4ef1d33b344e',  1, false),
  ('Silliman University Ballroom',     '9191f31e-ef89-4a03-a87f-5da30145abe5',120, false),
  ('Silliman University Ballroom',     '80a7c9ae-e821-42bc-bb4e-b1b4a2d66433',120, false),
  ('Silliman University Ballroom',     '64cabf9a-b7f2-4387-b6fe-c94bece8e84f', 20, false)
) as v(venue, eq, qty, returned)
join booking b on b.venue = v.venue;

-- ---------------------------------------------------------------------------
-- 4. Vehicle assignments
-- ---------------------------------------------------------------------------
-- Two rows per vehicle per booking: the setup run before the event and the
-- collection run after. dispatch_datetime < event_datetime is a Setup run and
-- >= is a Collection run — the leg is derived, never stored. See
-- docs/blueprint-03-dispatch.md.
--
-- Piapi Beach Road gets the motorcycle so a SHORT ORDER holds a dispatch,
-- which is the case docs/ops-manager-sync.md §5.0.1 says a package-only
-- Operations Manager module would strand. No vehicle serves two bookings on
-- the same date here.

insert into vehicle_assign (booking_id, vehicle_id, assignment_status, dispatch_datetime)
select b.booking_id, v.veh::uuid, v.status, v.at::timestamptz
from (values
  ('Sta. Monica Beach Club',           'd8e71dba-d2d7-48b9-a9c9-b5143d198c1f','Scheduled','2026-09-11 08:00+08'),
  ('Sta. Monica Beach Club',           'd8e71dba-d2d7-48b9-a9c9-b5143d198c1f','Scheduled','2026-09-11 17:00+08'),
  ('Sta. Monica Beach Club',           '501ca11b-1092-419d-9e32-67525661f767','Scheduled','2026-09-11 08:00+08'),
  ('Sta. Monica Beach Club',           '501ca11b-1092-419d-9e32-67525661f767','Scheduled','2026-09-11 17:00+08'),
  ('Villa Amanda, Valencia',           'ab2b1711-3368-472f-9b94-2ab3408690b4','Scheduled','2026-09-19 13:00+08'),
  ('Villa Amanda, Valencia',           'ab2b1711-3368-472f-9b94-2ab3408690b4','Scheduled','2026-09-19 22:00+08'),
  ('Piapi Beach Road',                 '41857ccc-55d4-4bbd-9761-2b7daf85ecfb','Scheduled','2026-09-12 08:00+08'),
  ('Piapi Beach Road',                 '41857ccc-55d4-4bbd-9761-2b7daf85ecfb','Scheduled','2026-09-12 11:00+08'),
  ('Silliman University Gymnasium',    'd8e71dba-d2d7-48b9-a9c9-b5143d198c1f','Completed','2026-07-12 07:00+08'),
  ('Silliman University Gymnasium',    'd8e71dba-d2d7-48b9-a9c9-b5143d198c1f','Completed','2026-07-12 16:00+08'),
  ('Bethel Guest House Function Room', '501ca11b-1092-419d-9e32-67525661f767','Completed','2026-08-08 14:00+08'),
  ('Bethel Guest House Function Room', '501ca11b-1092-419d-9e32-67525661f767','Completed','2026-08-08 23:00+08')
) as v(venue, veh, status, at)
join booking b on b.venue = v.venue;

-- ---------------------------------------------------------------------------
-- 5. Repair status_order after the trigger
-- ---------------------------------------------------------------------------
-- The set_status_order trigger has just written its own mapping over every row
-- inserted above, and that mapping has no slot for Confirmed. This restores the
-- values utils/bookingStatus.js sorts by. It touches status_order only, so the
-- trigger (UPDATE OF booking_status) does not fire and the correction holds.
--
-- Applied to EVERY booking, not just the seeded ones, because the trigger has
-- been mis-writing this column for every insert the app has ever made.

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

commit;

-- ---------------------------------------------------------------------------
-- 6. Verify (run after the commit)
-- ---------------------------------------------------------------------------
-- Expected with BKG-105 still present:
--
--   Pending 2 · Approved 1 · Confirmed 5 · Completed 3 · Rejected 1 · Cancelled 2
--   payment rows 15 · booking_equipment rows 17 · vehicle_assign rows 16
--   Payments Received, September 2026 .......... 39,000
--   Retained from cancellations, September ..... 7,000
--   Pending Verification rows .................. 1
--   Refund rows (negative amount_paid) ......... 1
--   Rizal Boulevard equipment rows ............. 0   (PR-27, on purpose)
--   Bethel payment count ....................... 3   (PR-03, on purpose)
--   status_order disagreeing with the app ...... 0
--
-- select booking_status, status_order, count(*) from booking group by 1,2 order by 2;
