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
- Calibrated with PG's on 30 Aug 2026. A setup run is 1 h out, 3 h setting up (finishing as the event starts), then 1 h back to base — the van does **not** wait out the event. Collection is a separate run starting 4 h after the event begins (PG's returns 4-7 h afterwards; the early end is taken so a van is never promised elsewhere while it may already be collecting). Two setups on one van need a 1.5 h reload gap at base.
- `planSetupChain` and `tripsConflict` must agree about when a van is free. The chain's deadline is when *setup finishes*; the dispatch window runs on until the van is *home*, so the chain subtracts the return leg explicitly. Without that the planner proposes chains the conflict checker then refuses.
- Short orders are **pickup or delivery**, and the admin schema does not record which. The customer app asks; nothing readable here stores the answer.
- PG's charges a delivery fee only **outside Bayawan, Santa Catalina and Basay** — inside those three it delivers free. So a zero fee does **not** mean pickup: it means pickup *or* an ordinary local delivery. `getShortOrderFulfilment` therefore asserts only `Delivery` (fee > 0) and otherwise reports "not recorded" with its basis, rather than guessing.
- `needsTransport()` returns true for everything until that flag is readable. Guessing "pickup" would strand free local deliveries with no van; an unnecessary van is one untick in the approval panel.
- The fee is cross-checked against the venue: charged inside the free area, or not charged outside it, raises a **Check fee** flag. Venue is free text, so this prompts a human rather than deciding anything.
- The Availability tab draws a **day timeline**: one row per vehicle, one block per dispatch, on a fixed 04:00–23:00 scale. A gap between blocks is time the vehicle is free. The scale is fixed rather than fitted to the day so blocks sit in the same place from date to date.
- **Committed / In Use / Available** are the settled words (blueprint-02). The cards, the filter pills and the Fleet tab all use them. `blueprint-03` proposed "On the road" / "Free" for the cards; that was declined because it would be a third vocabulary on one screen.
- The Fleet tab counts **trips booked**, and says "In use" only when a dispatch window contains now. A van booked three weeks out is committed, not in use.
- History groups one row per booking, expandable to the individual vehicles. A part-returned dispatch reads as its least-finished stage, never as Returned.
- Deleting a vehicle is refused twice over: once if it is dispatched to an active booking, again if it has ANY dispatch history, because the utilization reports read from it. Retire with Flag issue → Unavailable instead.
- Return-all is scoped with `.neq('assignment_status', 'Completed')`, so re-returning a partly-returned dispatch cannot rewrite rows that were already closed.

- The Availability tab accepts `assignBookingId` in router state, so a booking's detail page can open the assign modal for that booking directly.

- A **Needs a vehicle** counter appears in the header only when there are upcoming events with nothing dispatched to carry them. Auto-allocation at approval normally keeps it at zero; the day it is not zero is the day it earns its place.

- **An event setup defaults to three vehicles** (`EVENT_SETUP_DEFAULT_VEHICLES`), capped by what is in service — the load a typical package takes, not the size of the fleet. Deliveries take one. The approval panel lists every serviceable vehicle and the manager ticks what actually goes, so the default never decides on its own.

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

- ~~Open question: whether `vehicle_assign` allows one row per booking+vehicle.~~ **Settled 30 Aug 2026: it does not.** The table carries three foreign keys and a primary key on `assignment_id`, and nothing else — a booking can hold a setup row and a pickup row for the same vehicle, so the two-leg model persists as designed. The code's contrary comment has been corrected.
- `blueprint-03-dispatch.md` documents a superseded model (`leadHours`/`serviceHours`/`returnHours`); the code implements `travelHours`/`setupHours`/`teardownHours`/`hasPickup`.
