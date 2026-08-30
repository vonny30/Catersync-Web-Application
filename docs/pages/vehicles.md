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
- Short orders are **pickup or delivery**, and the customer app records which by writing the collection point into `venue`: **`Pickup - Main Branch`**. There is no column for it — the venue string *is* the flag.
- The rule is strictly binary: venue is that marker → **Customer pickup**; anything else, including an empty venue → **Delivery**. Matching tolerates casing, inner spacing and Pick-up/Pick up, but nothing else — a loose rule would read a delivery address like "Pickup point near the plaza" as a collection and withhold the van.
- `needsTransport()` is false only for a pickup, so a collection auto-allocates no vehicle and is skipped by the "Awaiting Vehicle" queue. The approval panel still lists every van, because a customer who changes their mind is a phone call, not a new booking.
- **This is a convention, not a constraint.** If the customer app changes the wording or adds a second branch, those orders read as deliveries and get a van — the safe direction to break in, but still wrong. Re-check if PG's opens another branch.
- **A pickup shows no fleet at all.** The approval panel swaps Fleet Availability for a Service Method card — no vehicle list, no pill counting vans ready. A list of available vehicles beside an order nobody drives is an invitation to assign one by mistake. Assigning is still possible from the Vehicles page, which is the right weight for an exception.
- **Editing the service method reconciles dispatch.** `Approved` is not in `PAYMENT_LOCKED_STATUSES`, so an approved order can still be edited — and approval is when its vehicle was assigned. Switching an approved delivery to a pickup used to leave the van scheduled for a trip that never happens, blocking it for other bookings. `reconcileServiceMethodChange` releases Scheduled rows (never Completed ones — those are history) and reports the count. The reverse direction is not auto-allocated: the manager is told, and the "Awaiting Vehicle" queue catches it.
- **An empty vehicle selection is not always a shortfall.** The approval panel sends `[]` for a pickup, which the manager-override path read as "chose no vehicle" and warned about. Guarded by `needsTransport`.
- **Assignment is gated by booking status.** `ACTIVE_BOOKING_STATUSES` only — approval is what auto-allocates, so assigning to a Pending booking would be duplicated by the allocation approval then runs. Enforced on the button and re-checked in the submit handler, since a page can be left open while the booking changes elsewhere.
- **Conflicts are re-checked against fresh rows immediately before inserting.** `vehicle_assign` has no uniqueness constraint (three FKs and a PK, confirmed against the live schema), so nothing in the database prevents double-booking a van; the check is entirely client-side and reasons over whatever was loaded when the modal opened. `recheckConflictsBeforeInsert` does not make it atomic — only a constraint could, and that is a schema change on a shared database — but it shrinks the race from "however long the modal has been open" to one round trip.
- **Cancelling or rejecting a booking releases what is still held and keeps what already happened.** Those cleanups were unfiltered deletes, which took completed dispatches and returned equipment with them; a van that made the trip is a fact the cancellation does not undo, and the History tab reads these rows unfiltered. Now filtered to `assignment_status <> 'Completed'` and `returned = false`. Retained rows are invisible to the conflict checker and every active view, so they hold neither a vehicle nor stock. **Hard deletes stay unfiltered** — the booking row itself goes, and the foreign key needs the whole lot cleared.
- Customer pickups are **excluded from the assign dropdown** — nothing is driven anywhere, so they are not candidates for a vehicle. The count of hidden ones is shown rather than silently dropping them, since a manager searching by reference would otherwise think the order had gone missing. To assign one, change its Service Method to Delivery first.
- **Manual assign writes an unambiguous instant.** `dispatch_datetime` came straight from the `datetime-local` input ("2026-09-18T16:15", no zone). `vehicle_assign.dispatch_datetime` is timestamptz, so Postgres read that in the database's timezone (UTC) and stored 16:15Z — read back in Manila as 00:15 the NEXT DAY. Eight hours late, which also pushed the trip past its own event and made `getDispatchWindow` classify a setup run as a collection run. Now `new Date(value).toISOString()`, matching what auto-allocation always did. Same family as the `pay_datetime` shift.
- **Leg names depend on the trip type.** `TRIP_LEG` stays the semantic key the overlap and chain logic compare against; `legLabel` is what is shown. An event setup has a Setup run and a Collection run; a short order is one **Delivery** and nothing comes back, so calling its only leg a "Setup run" described a job that does not happen.
- Dispatch rows carry a **Package / Short Order** badge, so a row read on its own says what it belongs to.
- The dispatch-time caption is **derived from the field's actual value**, not a fixed string. It had read "2 hours before event" since before the trip profile existed, contradicting the field directly above it: a package leaves 4 h ahead (1 h travel + 3 h setup), a short-order delivery 45 min. It also stays true when the time is edited by hand, and says "after the event starts" for a collection run.
- The admin's own short-order form writes the same marker via a Service Method selector, so a counter order is readable the same way as an app order. Typed freehand it would not be — "Main Branch" is not the marker and would send a van to fetch nothing.
- PG's delivers free within **Bayawan, Santa Catalina and Basay**; a fee applies outside. The fee is cross-checked against the venue — charged inside the free area, or not charged outside it, raises **Fee mismatch**. Venue is free text, so this prompts a human rather than deciding anything. The delivery-fee input is withheld entirely on a pickup, in both the create form and the approval modal.
- The Availability tab draws a **day timeline**: one row per vehicle, one block per dispatch, on a fixed 04:00–23:00 scale. A gap between blocks is time the vehicle is free. The scale is fixed rather than fitted to the day so blocks sit in the same place from date to date.
- **Committed / In Use / Available** are the settled words (blueprint-02). The cards, the filter pills and the Fleet tab all use them. `blueprint-03` proposed "On the road" / "Free" for the cards; that was declined because it would be a third vocabulary on one screen.
- The Fleet tab counts **trips booked**, and says "In use" only when a dispatch window contains now. A van booked three weeks out is committed, not in use.
- History groups one row per booking, expandable to the individual vehicles. A part-returned dispatch reads as its least-finished stage, never as Returned.
- Deleting a vehicle is refused twice over: once if it is dispatched to an active booking, again if it has ANY dispatch history, because the utilization reports read from it. Retire with Flag issue → Unavailable instead.
- Return-all is scoped with `.neq('assignment_status', 'Completed')`, so re-returning a partly-returned dispatch cannot rewrite rows that were already closed.

- The Availability tab accepts `assignBookingId` in router state, so a booking's detail page can open the assign modal for that booking directly.

- An **Awaiting Vehicle** counter appears in the header only when there are upcoming events with nothing dispatched to carry them. Auto-allocation at approval normally keeps it at zero; the day it is not zero is the day it earns its place.

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
