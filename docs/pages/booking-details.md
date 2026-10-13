# Booking Details

`/app/bookings/:id` — **src/pages/BookingDetails.jsx** (2706 lines)

## What it is for
One booking in full: customer, package, menu selections, equipment, vehicles,
payments and refunds, plus every lifecycle action. The largest surface in the
app and the one that writes the most.

## Rules that matter
- Equipment can only be assigned while a booking is **Approved** — not Pending (nothing is allocated until approval, which is what approval does) and not Confirmed (locked). Derive it as `ACTIVE_BOOKING_STATUSES.includes(s) && !isPaymentLedgerLocked(s)`, never a hardcoded `'Approved'`.
- Changing package or pax re-allocates equipment. The template is read **before** anything is deleted: a package with no template keeps the existing equipment rather than being wiped.
- Re-allocation clears only `returned = false` rows. Returned rows are the booking's return history, which the Equipment page's History tab reads.
- Deleting removes payments. The confirmation names the record count and verified total, because that money leaves every report.
- Children are deleted before the parent for the foreign keys, so a late failure leaves the booking standing with payments already gone. The failure message says so.

- A **Dispatch** section lists the vehicles carrying the event, each run named by its leg (Setup run / Collection run for a package, Delivery for a short order) with its window, sorted so the setup run reads before the collection run.
- **Assigning a vehicle happens here**, in `components/AssignVehicleModal`, not by navigating to the Vehicles page. Same booking, same page, same place on it. Conflict detection and the dispatch window come from `utils/vehicle` (`findConflictingAssignment`, `describeAssignment`) — the Vehicles page calls the same functions, so the two can never disagree about whether a van is free.
- Card order is the lifecycle order: **what was ordered → the money → its exceptions → what has to be loaded → what carries it.**

- **Installment plans (suki customers, 14 Oct 2026; spec `docs/feature-suki-installments.md`).** `components/InstallmentPlanCard` sits above Payment Tracking. It reads `v_booking_installments` and `booking_installment_log`, and every change goes through `f_save_installment_plan` / `f_end_installment_plan` (both refuse with a sentence that is shown as is). It renders nothing for a Standard booking unless the customer is suki and the booking is Approved or Confirmed ("Start installment plan").
- The **Approve** pop-up offers Standard / Installment only for a suki customer; for anyone else it is unchanged. Approving on a plan confirms the booking at once (status history source "Suki installment plan").
- On a plan booking: Record Payment skips only the 50% first-deposit rule; Complete is allowed after the event with installments still owed ("₱X in installments will stay receivable"); Override cannot move it to Pending or Approved (end the plan first); and the "Past Event — ₱X Remaining" and "Balance Remaining" chips are not shown, because the plan card shows what is due and when.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking_equipment` | 3 | no |
| `category` | 1 | no |
| `customer` | 1 | no |
| `equipment` | 2 | **yes — 1** |
| `menu_item` | 2 | no |
| `package` | 2 | no |
| `package_category` | 1 | no |
| `package_equipment` | 1 | no |
| `payment` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `booking (delete)` | 1 |
| `booking (update)` | 3 |
| `booking_equipment (delete)` | 3 |
| `booking_equipment (insert)` | 1 |
| `booking_equipment (update)` | 1 |
| `payment (delete)` | 1 |
| `vehicle_assign (delete)` | 1 |

## Shared modules it depends on

- **utils:** `autoComplete`, `bookingStatus`, `equipment`, `formErrors`, `payments`
- **hooks:** `useApprovalHandlers`, `useCancellationHandlers`, `useCompletionHandlers`, `useConfirmationHandlers`, `usePaymentHandlers`, `useRealtimeRefresh`, `useRejectionHandlers`, `useVerificationHandlers`
- **realtime:** none

## Review status

Audited 30 Aug 2026 — the destructive re-allocation and the delete messaging were fixed.

## Known gaps

- ~~One unbounded whole-table read (`equipment`).~~ **Fixed 30 Aug 2026.**
- The equipment quantity edit's stock check reads `booking_equipment` for one equipment id unbounded — bounded in practice, not in principle.
