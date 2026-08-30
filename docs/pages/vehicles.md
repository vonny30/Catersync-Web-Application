# Vehicles

`/app/vehicles` — **src/pages/Vehicles.jsx** (2346 lines)

## What it is for
The fleet and its dispatches. Rebuilt in a prior session around dispatch
**windows** rather than whole-day locks, so one vehicle can serve a morning
setup and an afternoon delivery.

## Rules that matter
- A dispatch occupies a vehicle for a trip window, not a calendar day. Two trips conflict only when their windows overlap, with a gap between them.
- The leg is derived, not stored: a dispatch at or after the event start is a pickup, anything earlier is a setup.
- Trip profile constants live in `utils/vehicle.js` — they are the model, and changing them changes how many trips a day the system permits.
- History groups one row per booking, expandable to the individual vehicles. A part-returned dispatch reads as its least-finished stage, never as Returned.
- Deleting a vehicle is refused twice over: once if it is dispatched to an active booking, again if it has ANY dispatch history, because the utilization reports read from it. Retire with Flag issue → Unavailable instead.
- Return-all is scoped with `.neq('assignment_status', 'Completed')`, so re-returning a partly-returned dispatch cannot rewrite rows that were already closed.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 1 | no |
| `vehicle` | 1 | no |
| `vehicle_assign` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `vehicle (delete)` | 1 |
| `vehicle (insert)` | 1 |
| `vehicle (update)` | 2 |
| `vehicle_assign (insert)` | 1 |
| `vehicle_assign (update)` | 2 |

## Shared modules it depends on

- **utils:** `bookingStatus`, `fetchAllRows`, `formErrors`, `statusLabels`, `vehicle`
- **hooks:** `useRealtimeRefresh`
- **realtime:** channel `vehicles-page` on `booking`, `vehicle`, `vehicle_assign`

## Review status

Audited 30 Aug 2026 — the page's own logic reviewed, layout modernized, history grouped by booking. The dispatch model's pure functions were tested separately (14/14).

## Known gaps

- **Open question:** the code asserts `vehicle_assign` allows only one row per booking+vehicle. If true, the pickup leg never persists and the two-leg model's second half is decorative. Settle with: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'vehicle_assign'::regclass;`
- `blueprint-03-dispatch.md` documents a superseded model (`leadHours`/`serviceHours`/`returnHours`); the code implements `travelHours`/`setupHours`/`teardownHours`/`hasPickup`.
