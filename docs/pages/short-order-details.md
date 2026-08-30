# Short Order Details

`/app/orders/:id` — **src/pages/ShortOrderDetails.jsx** (1954 lines)

## What it is for
The same page for a tray order. No equipment section, since short orders have
none; otherwise the same lifecycle actions through the same hooks.

## Rules that matter
- Same delete semantics and messaging as Booking Details.
- A deleted record is a normal outcome, not an error: the fetch uses `.maybeSingle()` and renders 'not found' rather than raising a toast. `.single()` returns HTTP 406 for a missing row.

- A **Dispatch** section, same as Booking Details. A short order's trip type is Delivery, matching `getTripType`.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 1 | no |
| `customer` | 1 | no |
| `menu_item` | 2 | no |
| `payment` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `booking (delete)` | 1 |
| `booking (update)` | 3 |
| `payment (delete)` | 1 |
| `vehicle_assign (delete)` | 1 |

## Shared modules it depends on

- **utils:** `autoComplete`, `bookingStatus`, `formErrors`, `payments`
- **hooks:** `useApprovalHandlers`, `useCancellationHandlers`, `useCompletionHandlers`, `useConfirmationHandlers`, `usePaymentHandlers`, `useRealtimeRefresh`, `useRejectionHandlers`, `useVerificationHandlers`
- **realtime:** none

## Review status

Reviewed alongside Booking Details.

## Known gaps

- Not exercised against real data.
