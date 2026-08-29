# Bookings

`/app/bookings` — **src/pages/Bookings.jsx** (2356 lines)

## What it is for
The package-booking list: filter, sort, page, and act on bookings without
opening them. Approve, reject, confirm, complete, cancel and delete all run
through the shared handler hooks.

## Rules that matter
- Sort order is `status_order`, then unread, then `book_datetime`, then `booking_id`. The final unique key matters: `.range()` paging over a non-total ordering skips and repeats rows.
- `status_order` is **not** maintained by the database. Every write that changes `booking_status` must set the matching value from `utils/bookingStatus`. The page self-heals drift via `findStatusOrderDrift`.
- Realtime is filtered to `booking_type=eq.Package`.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 3 | **yes — 1** |
| `customer` | 4 | **yes — 1** |
| `menu_item` | 1 | no |
| `package` | 3 | no |
| `package_category` | 1 | no |
| `payment` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `booking (delete)` | 2 |
| `booking (insert)` | 1 |
| `booking (update)` | 5 |
| `booking_equipment (delete)` | 2 |
| `payment (delete)` | 2 |
| `payment (update)` | 1 |
| `vehicle_assign (delete)` | 2 |
| `vehicle_assign (update)` | 1 |

## Shared modules it depends on

- **utils:** `autoComplete`, `bookingStatus`, `createWalkInCustomer`, `equipment`, `formErrors`, `payments`
- **hooks:** `useApprovalHandlers`, `useRealtimeRefresh`, `useRejectionHandlers`
- **realtime:** channel `bookings-page` on `booking`

## Review status

Sorting, paging and the responsive table reviewed. Business logic mostly delegated to the hooks, which were audited separately.

## Known gaps

- Two whole-table reads with no row bound (`booking`, `customer`) — PostgREST truncates at 1000 without an error.
- The page's own money display was not audited independently of the hooks.
