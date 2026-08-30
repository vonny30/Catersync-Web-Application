# Short Order Details

`/app/orders/:id` — **src/pages/ShortOrderDetails.jsx** (1954 lines)

## What it is for
The same page for a tray order. No equipment section, since short orders have
none; otherwise the same lifecycle actions through the same hooks.
- A **Dispatch** section lists the vehicle carrying the order, its leg named **Delivery** (a short order is delivered and nothing comes back — there is no setup or collection run) with its window.
- **Assigning a vehicle happens here**, in `components/AssignVehicleModal`, not by navigating to the Vehicles page. Conflict detection and the dispatch window come from `utils/vehicle` (`findConflictingAssignment`, `describeAssignment`) — the Vehicles page calls the same functions, so the two can never disagree about whether a van is free.
- On a **customer pickup** the whole section says no vehicle is needed and the assign button is hidden.
- **Menu Items sits first** in the right column — it is the order itself, and it used to be last, below payments, refunds and dispatch. Card order is now the lifecycle order: what was ordered → the money → its exceptions → what carries it.

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
