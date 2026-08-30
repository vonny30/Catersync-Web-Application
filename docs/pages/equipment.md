# Equipment

`/app/equipment` — **src/pages/Equipment.jsx** (3852 lines)

## What it is for
Five tabs over one question: is there enough equipment for what is coming?
Upcoming prep by day, availability on a chosen date, the inventory itself,
active assignments, and the full assignment history.

## Rules that matter
- Availability is measured against **usable** stock (`quantity_available`), which excludes damaged and under-maintenance units. That is why Available can sit well below what the business owns.
- 'Is this booking short of equipment?' is structurally always false for Approved/Confirmed bookings, because approval allocated the whole template. Shortages are a **per-day, cross-event** question — several events share one pool.
- `getBookingEquipmentLines` is the single definition of required-vs-assigned, used by both the prep view and the Assign modal so they cannot disagree.
- Returns are due within 24h of event start and recordable from 3h after; overdue is measured from the deadline, not the event.
- History groups one row per booking, expandable to the individual equipment rows.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking_equipment` | 3 | no |
| `equipment` | 1 | **yes — 1** |
| `package_equipment` | 2 | **yes — 1** |

## Data it writes

| Operation | Sites |
|---|---|
| `booking_equipment (insert)` | 1 |
| `equipment (delete)` | 1 |
| `equipment (update)` | 1 |

## Shared modules it depends on

- **utils:** `bookingStatus`, `equipment.jsx`, `formErrors`, `payments`, `statusLabels`
- **hooks:** `useRealtimeRefresh`
- **realtime:** channel `equipment-page` on `booking`, `booking_equipment`, `equipment`, `package_equipment`

## Review status

Heavily reviewed. History grouping and the assign-modal allocation plan added 29-30 Aug 2026.

## Known gaps

- ~~Two unbounded whole-table reads (`equipment`, `package_equipment`).~~ **Fixed 30 Aug 2026** — and a third the audit had missed: the `booking_equipment` assignment list, which this page's availability maths counts. Truncated, it would have reported stock as free that was actually out.
- RLS hides `equipment`, `booking_equipment` and `package_equipment` from an unauthenticated client, so these paths are code-reviewed rather than exercised.
