# Receivables

Formerly **Payments**. Rebuilt on 19 September 2026 around accounting rules: one page for
money coming in, one test for whether money counts, and no edits after the fact.

> Source of truth: the CaterSync Admin Web system reference, §11. This page mirrors it; if
> they disagree, the reference wins and this page is stale.

## Two cards

| Card | Subtext | Basis | Source |
| --- | --- | --- | --- |
| Payments Received | All verified receipts | Cash basis | `f_report_period.cash_receipts` |
| Collectible | Not yet collected | Accrual basis | `outstanding` where `counts_toward_revenue` |

Renamed 21 September 2026 (were Cash Receipts and Total Receivables). Collectible
counts Confirmed and Completed bookings only; Pending and Approved amounts are not yet
collectible and never appear here.

Both follow one **Period** control. Payments Received is scoped by payment date;
Collectible by service date. The month is in the period title, not the card label.
September 2026: ₱161,700 and ₱55,950. All time, Collectible is ₱92,800.

The four status cards that used to sit beside these are now a **Stage** filter: Deposit
Collected, Partially Settled, Fully Settled.

The Dashboard's Payments Received card links here with the period it was showing, so the
receipts behind that figure are the rows listed on arrival.

## Entry types

| `entry_type` | Sign | Meaning | Written by |
| --- | --- | --- | --- |
| Receipt | + | Money received | Manager or customer app |
| Refund | − | Money returned | Manager, through cancel or reject |
| Reversal | − | Corrects an entry that should never have existed | Manager only |

A Refund's evidence depends on its method (`utils/refundEvidence.js`): **Cash** needs
the number on the receipt handed to the customer, written to `receipt_reference`, and the
image is optional; **GCash** and **Bank Transfer** need an image in `pay_proof`. This is the
rule Record Receipt already applies. The database does not enforce it for refunds —
`payment_evidence_check` covers receipts only — so the forms do.

`payment_reversal_shape_check` requires a Reversal to carry `reverses_payment_id`, a
`reversal_reason` and a negative amount. A Reversal can also demote its booking from
Confirmed to Approved — see the reference, §20.

## Status values

Pending Verification · Proof Rejected · Deposit Collected · Partially Settled · Fully
Settled · Refunded · Reversed. Enforced by `payment_pay_status_check`.

`Downpayment` and `Fully Paid` no longer exist. Renaming them broke production once,
because stored values changed before the frontend shipped. Change code first, or both
together.

## What counts

`v_payment_ledger.counts_in_ledger` is the only test. A row counts when it is verified, is
not itself a Reversal, and is not reversed by another row. **No client reimplements it.**

A reversed receipt keeps its original `pay_status` (often Fully Settled), so any sum over
verified positive rows will still count it. Read `counts_in_ledger` or `net_paid`, never
`pay_status`, to decide whether money counts.

BKG-103 is the proof case. It carries a ₱7,500 receipt reversed on 19 September that still
reads Fully Settled. The booking detail hero shows ₱7,500 owed and 50% collected — correct —
because its sum filters on `movesBooks`, which returns `counts_in_ledger` for rows read from
`v_payment_ledger`. The same helper falls back to a verification-only test for raw
`payment` rows, which would count the reversed receipt. Feed displays from the view.

A reversed receipt stays on screen, struck through, with its reason. An unverified receipt
shows as awaiting verification and counts nowhere.

## Evidence

`pay_proof` is nullable: a cash receipt recorded at the counter carries a
`receipt_reference` instead. `payment_evidence_check` requires one or the other on a
recorded Receipt.

## Append-only

Payments are never edited or deleted. A correction is a Reversal, money back is a Refund,
and neither touches the original row.

## Installment plans (suki customers, 14 Oct 2026)

A booking with `payment_plan = 'Installment'` (spec: `docs/feature-suki-installments.md`)
follows its schedule instead of the 50% deposit rule. On this page:

- **Record Receipt** skips only the 50% first-deposit rule for a plan booking
  (`validateReceipt` with `paymentPlan`); every other rule still applies. The booking
  picker marks plan bookings and shows what is due now, and the receipt form shows
  "due now / next" with a one-click fill instead of the deposit hint.
- A **Payment plan** filter (All / Installment plans) narrows the receipt rows. It
  never narrows the Accounts Receivable breakdown, whose Balance Due must still add
  up to the card.
- The **Accounts Receivable** breakdown marks plan rows with "Due now · Next … on …"
  and the overdue chip. For a plan booking `is_overdue` / `days_overdue` come from the
  schedule (`v_booking_money`), never computed here. A completed plan booking with
  installments still owed stays receivable.
- A reversal never sends a plan booking back to Approved (`f_maybe_unconfirm_booking`
  returns early for plans); its installments simply become unpaid again.

## Open

- Approved sat outside the payment-locked status list before the rework, which caused the
  approval-fee adjustment problem. Not re-checked since.
