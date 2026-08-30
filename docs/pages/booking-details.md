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

- A **Dispatch** section lists the vehicles carrying the event, their departure time and trip type, and links straight into the Vehicles assign modal with this booking preselected (blueprint-03 §5.8).

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

- One unbounded whole-table read (`equipment`).
- The equipment quantity edit's stock check reads `booking_equipment` for one equipment id unbounded — bounded in practice, not in principle.
