# Payments

`/app/payments` — **src/pages/Payments.jsx** (2407 lines)

## What it is for
Every payment and refund across all bookings, grouped one row per booking with
the individual payments behind it. Also where a customer's uploaded proof is
verified or rejected, and where a manager records a payment by hand.

## Rules that matter
- **Verification comes first.** Recording a payment is refused while any payment on that booking is `Pending Verification` — otherwise verifying the proof afterwards counts the same transfer twice. `Proof Rejected` does not block; it has been ruled on.
- This page has its **own** record-payment form, separate from the `usePaymentHandlers` hook the detail pages use. Any rule about recording payments has to be added to both. Both call `getPaymentsAwaitingVerification`.
- Refunds are negative `amount_paid` rows, so a plain sum is already net.
- Bordered badge maps are kept for modals (pills on coloured surfaces); soft borderless maps for the table. Both are live — neither is dead code.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `payment (insert)` | 1 |
| `payment (update)` | 2 |

## Shared modules it depends on

- **utils:** `fetchAllRows`, `payments`, `reportMetrics`
- **hooks:** `useRealtimeRefresh`
- **realtime:** channel `payments-page` on `booking`, `payment`

## Review status

Modernized and audited; the verification-first rule was added 30 Aug 2026.

## Known gaps

- Verification computes `finalStatus` before the password prompt, so a payment arriving during the prompt could mislabel Downpayment vs Fully Paid. Display-only, recomputed by `describePaymentKind`.
