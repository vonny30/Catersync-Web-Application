-- backfill_bkg127_equipment.sql
--
-- NOT APPLIED. For Vaughn to run in the Supabase SQL editor.
--
-- BKG-127 (Katrina Juanero, 50 pax, event 25 Sep 2026) was approved from the
-- Dashboard, whose approve pop-up read bookings without package_id. Approval
-- therefore skipped the equipment allocation it exists to do, and the booking
-- reached Confirmed with no equipment at all — its package template lists 7
-- items. Confirmed bookings are locked in the app, so it cannot be fixed from
-- the Equipment page. The Dashboard bug itself is fixed in code (shared
-- components/ApprovalModal); this only repairs the one booking it hit.
--
-- Inserts exactly what allocateEquipmentForBooking would have inserted at
-- approval (same quantity rule, 50 pax). Checked 22 Sep: every item is free on
-- 25 Sep with nothing else committed that day.
--
--   Buffet Tables 2 · Chafing Dishes 5 · Chair Covers 50 · Guest Tables 9 ·
--   Monobloc Chairs 50 · Table Covers 9 · Utensil Sets 50
--
-- Safe to run twice: it inserts nothing if BKG-127 already has equipment.

insert into public.booking_equipment (booking_id, equipment_id, quantity, notes, returned, assigned_at)
select b.booking_id,
       pe.equipment_id,
       case when pe.per_pax
            then case when coalesce(e.pax_per_unit, 0) > 0
                      then ceil(b.pax_count::numeric / e.pax_per_unit)
                      else greatest(1, ceil(pe.included_quantity * b.pax_count)) end
            else coalesce(nullif(pe.included_quantity, 0), 1) end,
       'Auto-allocated from package (' || b.pax_count || ' pax)'
         || case when e.pax_per_unit is not null then ' – ' || e.pax_per_unit || ' pax/unit' else '' end
         || ' – backfilled 22 Sep 2026 (missed at Dashboard approval)',
       false,
       now()
from public.booking b
join public.package_equipment pe on pe.package_id = b.package_id
join public.equipment e on e.equipment_id = pe.equipment_id
where b.booking_number = 'BKG-127'
  and not exists (select 1 from public.booking_equipment x where x.booking_id = b.booking_id);

-- Check: 7 rows, quantities as listed above.
--   select e.eqm_name, be.quantity from public.booking_equipment be
--   join public.equipment e using (equipment_id) join public.booking b using (booking_id)
--   where b.booking_number = 'BKG-127' order by e.eqm_name;
