# Short Orders

`/app/orders` — **src/pages/ShortOrders.jsx** (2131 lines)

## What it is for
The same list, for tray orders. Short orders carry a `delivery_fee` and no
equipment; excluding them from equipment views is correct, not an oversight.

## Rules that matter
- Identical sort and self-heal rules to Bookings.
- A daily cap applies — see `MAX_SHORT_ORDERS_PER_DAY` in `utils/bookingStatus`, enforced at approval.
- Short Orders have no equipment. Approval allocates none.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 3 | **yes — 1** |
| `customer` | 3 | **yes — 1** |
| `menu_item` | 1 | no |
| `payment` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `booking (delete)` | 2 |
| `booking (insert)` | 1 |
| `booking (update)` | 5 |
| `payment (delete)` | 2 |
| `payment (update)` | 1 |
| `vehicle_assign (delete)` | 1 |
| `vehicle_assign (update)` | 1 |

## Shared modules it depends on

- **utils:** `autoComplete`, `availability`, `bookingStatus`, `createWalkInCustomer`, `formErrors`, `payments`
- **hooks:** `useApprovalHandlers`, `useRealtimeRefresh`, `useRejectionHandlers`
- **realtime:** channel `short-orders-page` on `booking`

## Review status

Reviewed alongside Bookings; same treatment, same conclusions.

## Known gaps

- ~~Same two unbounded whole-table reads as Bookings.~~ **Fixed 30 Aug 2026**, the same way and at the same time.
