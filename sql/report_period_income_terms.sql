-- report_period_income_terms.sql
--
-- NOT APPLIED. For Vaughn to review and run in the Supabase SQL editor.
-- The frontend does not change schema; this is the database half of the
-- "business terms" change of 21 Sep 2026.
--
-- Adds two columns to the END of f_report_period.
--
-- (22 Sep 2026: earned_revenue and collections_applied were removed from this
-- file. They added forfeited_deposits, which counts EVERY closed booking still
-- holding money — a refundable deposit not yet refunded included (BKG-129).
-- The app now counts forfeited deposits only, client-side, with
-- keptOnClosedBooking in utils/reportMetrics.) Every existing column keeps
-- its name, position and meaning, so every current reader is unaffected.
--
--   potential_income     Pending + Approved bookings by service date, EXCLUDING
--                        lapsed ones. "Potential Income from Unapproved
--                        Bookings": not yet collectible. Lapsed requests are
--                        left out because their date has gone - nothing about
--                        them can still become income. (September: 43,150.
--                        Including lapsed BKG-105 it would read 51,650.)
--
--   pending_payments     Claims awaiting verification (pay_status 'Pending
--                        Verification'), by payment date. Counted in no other
--                        figure until a manager verifies them. (September: 0.)
--
-- cash_receipts is NOT changed. It already counts every verified receipt
-- whatever happened to the booking afterwards - including the 24,000 received
-- on bookings later cancelled or rejected - so forfeited deposits are already
-- inside "Payments Received". Adding them again would count them twice.
--
-- Adding output columns changes the function's return type, which CREATE OR
-- REPLACE cannot do, so it is dropped and recreated in one transaction, and
-- the existing grants are restored exactly as they were.

begin;

drop function public.f_report_period(timestamptz, timestamptz);

create function public.f_report_period(p_start timestamptz, p_end timestamptz)
returns table(
  gross_contracted numeric, gross_approved numeric, gross_total_accepted numeric,
  outstanding_contracted numeric, outstanding_receivable numeric, paid_against_events numeric,
  contracted_count integer, approved_count integer, completed_count integer,
  cash_receipts numeric, refunds_issued numeric, reversals_recorded numeric, receipt_count integer,
  forfeited_deposits numeric, forfeited_count integer, paid_contracted numeric,
  potential_income numeric, pending_payments numeric
)
language sql
stable
set search_path to ''
as $function$
  with ev as (
    select * from public.v_booking_money m
    where (p_start is null or m.event_datetime >= p_start)
      and (p_end   is null or m.event_datetime <  p_end)
  ),
  pay as (
    select * from public.v_payment_ledger l
    where (p_start is null or l.pay_datetime >= p_start)
      and (p_end   is null or l.pay_datetime <  p_end)
  ),
  forf as (
    select m.booking_id, m.net_paid
    from public.v_booking_money m
    where m.is_closed
      and m.net_paid > 0
      and (p_start is null or m.event_datetime >= p_start)
      and (p_end   is null or m.event_datetime <  p_end)
  ),
  base as (
    select
      coalesce(sum(ev.total_amount) filter (where ev.counts_toward_revenue), 0) as gross_contracted,
      coalesce(sum(ev.total_amount) filter (where ev.booking_status = 'Approved'), 0) as gross_approved,
      coalesce(sum(ev.total_amount) filter (where ev.is_receivable), 0) as gross_total_accepted,
      coalesce(sum(ev.outstanding)  filter (where ev.counts_toward_revenue), 0) as outstanding_contracted,
      coalesce(sum(ev.outstanding)  filter (where ev.is_receivable), 0) as outstanding_receivable,
      coalesce(sum(ev.net_paid)     filter (where ev.is_receivable), 0) as paid_against_events,
      count(*) filter (where ev.counts_toward_revenue)::int as contracted_count,
      count(*) filter (where ev.booking_status = 'Approved')::int as approved_count,
      count(*) filter (where ev.booking_status = 'Completed')::int as completed_count,
      (select coalesce(sum(p.amount_paid), 0) from pay p
         where p.counts_in_ledger and p.amount_paid > 0) as cash_receipts,
      (select abs(coalesce(sum(p.amount_paid), 0)) from pay p
         where p.counts_in_ledger and p.amount_paid < 0) as refunds_issued,
      (select abs(coalesce(sum(p.amount_paid), 0)) from pay p
         where p.entry_type = 'Reversal') as reversals_recorded,
      (select count(*)::int from pay p
         where p.counts_in_ledger and p.amount_paid > 0) as receipt_count,
      (select coalesce(sum(f.net_paid), 0) from forf f) as forfeited_deposits,
      (select count(*)::int from forf f) as forfeited_count,
      coalesce(sum(ev.net_paid)     filter (where ev.counts_toward_revenue), 0) as paid_contracted,
      coalesce(sum(ev.total_amount) filter (
        where ev.booking_status in ('Pending', 'Approved') and not ev.is_lapsed), 0) as potential_income,
      (select coalesce(sum(p.amount_paid), 0) from pay p
         where p.pay_status = 'Pending Verification') as pending_payments
    from ev
  )
  select
    b.gross_contracted, b.gross_approved, b.gross_total_accepted,
    b.outstanding_contracted, b.outstanding_receivable, b.paid_against_events,
    b.contracted_count, b.approved_count, b.completed_count,
    b.cash_receipts, b.refunds_issued, b.reversals_recorded, b.receipt_count,
    b.forfeited_deposits, b.forfeited_count, b.paid_contracted,
    b.potential_income,
    b.pending_payments
  from base b;
$function$;

comment on function public.f_report_period(timestamptz, timestamptz) is
  'Period report aggregates. Service-date anchored: gross_*, outstanding_*, paid_contracted, paid_against_events, forfeited_*, potential_income. Payment-date anchored: cash_receipts, refunds_issued, reversals_recorded, receipt_count, pending_payments. Identity: paid_contracted + outstanding_contracted = gross_contracted (holds while no booking is overpaid; outstanding is clamped at zero). potential_income excludes lapsed bookings.';

-- Restore the grants exactly as they were before the drop.
grant execute on function public.f_report_period(timestamptz, timestamptz) to public, anon, authenticated, service_role;

commit;

-- Check after running:
--   select potential_income, pending_payments
--   from public.f_report_period('2026-09-01 00:00:00+08', '2026-10-01 00:00:00+08');
