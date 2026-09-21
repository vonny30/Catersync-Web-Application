-- payment_methods_per_business_rule.sql
--
-- NOT APPLIED. For Vaughn to run in the Supabase SQL editor.
--
-- THE RULE (Vaughn, 22 Sep 2026):
--   * A customer pays through the mobile app in one of two ways:
--       - a 50% deposit online, the balance later in cash; or
--       - the full amount online.
--     Online means GCash or Bank Transfer, with a screenshot.
--   * Cash is only ever recorded by the manager, from the paper receipt they
--     issue, so a cash payment carries the receipt NUMBER and no screenshot.
--     That covers the cash balance, and a deposit the manager takes in cash.
--
-- WHAT IS WRONG TODAY (checked 22 Sep):
--   A. Four DEPOSITS are marked Cash but came in with a screenshot and no
--      receipt number — i.e. online uploads. They become GCash; the
--      screenshot stays as their proof.
--        BKG-107 6,250 · BKG-111 4,250 · SO-024 2,950 · SO-028 4,100
--   B. Five cash BALANCE payments carry a screenshot and no receipt number.
--      They stay Cash, get a receipt number, and lose the screenshot.
--      The numbers are backfilled in one visible format, OR-<booking>-<n>,
--      because the original paper receipts were never recorded:
--        BKG-101 3,375 · BKG-103 7,500 (reversed) · BKG-106 12,000 ·
--        BKG-108 9,000 · BKG-116 3,000
--   Already right: BKG-129's cash deposit (receipt RFKC-LAPSE-110, no image),
--   and every GCash / Bank Transfer payment.
--
-- No amount, status, date or booking changes: only pay_method, pay_proof and
-- receipt_reference. The totals on every page are unaffected. The payment
-- confirm trigger re-runs on UPDATE and finds nothing to change.
-- Shared database: the customer mobile app reads these rows too.

begin;

-- A. Online deposits mislabelled Cash -> GCash.
update public.payment p
   set pay_method = 'GCash'
  from public.booking b
 where b.booking_id = p.booking_id
   and p.entry_type = 'Receipt'
   and p.pay_method = 'Cash'
   and p.receipt_reference is null
   and p.pay_proof is not null
   and b.booking_number in ('BKG-107', 'BKG-111', 'SO-024', 'SO-028');

-- B. Cash balance payments: receipt number only.
update public.payment p
   set receipt_reference = 'OR-' || replace(b.booking_number, '-', '') || '-02',
       pay_proof = null
  from public.booking b
 where b.booking_id = p.booking_id
   and p.entry_type = 'Receipt'
   and p.pay_method = 'Cash'
   and p.receipt_reference is null
   and b.booking_number in ('BKG-101', 'BKG-103', 'BKG-106', 'BKG-108', 'BKG-116');

commit;

-- Check: no Cash receipt without a number, none with a screenshot. Expect 0 rows.
select b.booking_number, p.pay_method, p.amount_paid, p.receipt_reference, p.pay_proof
  from public.payment p join public.booking b using (booking_id)
 where p.entry_type = 'Receipt' and p.pay_method = 'Cash'
   and (p.receipt_reference is null or p.pay_proof is not null);
