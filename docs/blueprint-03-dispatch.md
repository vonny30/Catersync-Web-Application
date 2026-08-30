# Blueprint 03 — Dispatch

The Vehicles page: what it is for, how a vehicle gets attached to a booking,
and what has to change so the two agree. Written 28 Aug 2026 against the tree
as it stood that day.

**All four phases are implemented (Phase 1, 28 Aug 2026; Phases 2-4, 30 Aug
2026).** §9.0 records the constraint question, since settled. §9.2 remains
open and is worth a conversation with PG's: the trip profile numbers decide
how many trips a day the system permits, and they are still estimates.

Read with `blueprint-01-reporting.md` (money) and `blueprint-02-language.md`
(vocabulary). Same hard constraint as both: **no schema changes.** Everything
below is derived read-only from `vehicle`, `vehicle_assign`, `booking`,
`booking_equipment` and `package_equipment`.

---

## 1. The job of this page

> **Answer one question — is there a vehicle for this event? — and let the
> manager act on the answer without leaving the page.**

Everything else the page does is in service of that. Equipment answers "do we
have enough"; Vehicles answers "can we get it there". The fleet is three
vehicles, so the answer is often "only just", and the page's real work is making
"only just" visible before it becomes "no".

The page today is built as a **fleet register that happens to track
assignments**. It should be a **dispatch board that happens to hold the fleet
list**. That inversion is the concept; §5 is what it looks like.

---

## 2. The business PG's Catering actually runs

From Vaughn, 28 Aug 2026:

> "the Catering we have as a client has 3 vehicles but they can handle
> simultaneous booking at the same day as long as equipment is enough and
> allocated properly and also they do deliveries"

Three facts. The system contradicts all three.

| The business | The system today |
|---|---|
| 3 vehicles, reused across the day | A vehicle assigned to any event is locked for the **whole calendar day** |
| Simultaneous bookings, limited by *equipment*, not by trucks | Vehicles are the binding constraint: 3 vehicles = 3 events per day, ever |
| Two kinds of trip — event setup and delivery | One kind. Nothing distinguishes them |

One idea fixes all three, and everything downstream follows from it:

> **A dispatch occupies a vehicle for a trip window, not for a day.**

A van that leaves at 06:00 for an 08:00 breakfast set-up, unloads, and is back
by 11:00 is **free for a 14:00 delivery**. Today the system refuses that second
trip. With three vehicles that is not cosmetic — it is roughly a third of the
fleet's real working capacity, given away by a `toDateString()` comparison.

---

## 3. How a vehicle gets attached to a booking

This is the lifecycle the page has to align with. Eight moments; the system
handles five of them and ignores three.

| # | Moment | Where | Vehicle today | Vehicle in this concept |
|---|---|---|---|---|
| 1 | Customer requests a booking | mobile / `Bookings.jsx` | — | — (correct: nothing is promised yet) |
| 2 | Manager reviews before approving | `ApprovalAvailabilityCheck.jsx` | **nothing** | **Fleet check** beside the equipment check |
| 3 | Manager approves | `useApprovalHandlers.js:244` | equipment auto-allocates, vehicles do not | **vehicles allocate with the equipment** |
| 4 | Manager adjusts the dispatch | `Vehicles.jsx` Assign modal | manual, whole-day locked | manual, window-based, pre-filled |
| 5 | Vehicle leaves | — | nothing | nothing (no schema for it — §10) |
| 6 | Vehicle comes back | `Vehicles.jsx` Return | manual, opens 3 h after event start | unchanged |
| 7 | Booking marked Completed | `useCompletionHandlers.js:61` | **all its vehicles auto-return** | unchanged — this is already right |
| 8 | Booking cancelled | `useCancellationHandlers.js:124` | assignment rows deleted | unchanged |

Two gaps, and they are the same gap seen from either end:

**Moment 2 has no fleet check.** `ApprovalAvailabilityCheck.jsx` warns about
other events that day and about equipment shortages. It contains no reference to
`vehicle` at all. A manager can approve an event on a day when all three
vehicles are already out and discover it at dispatch time — after the customer
has been told yes.

**Moment 3 does not allocate.** Equipment turns a package template plus a pax
count into real `booking_equipment` rows automatically. Vehicles are typed in by
hand, later, on a different page, from a booking picker — and nothing anywhere
reminds the manager that an approved event still has no vehicle. Approving an
event and dispatching for it are one decision that the system splits into two,
with no thread between them.

Closing both is what "aligns with how it will be assigned to the system" means
in practice: **the vehicle is decided at the same moment, on the same screen,
as the equipment.** The Vehicles page then becomes where you *adjust and watch*
dispatches, not where you remember to create them.

---

## 4. The model

Three derived concepts, no new columns.

### 4.1 Trip type

| Condition | Trip type |
|---|---|
| `booking_type === 'Short Order'` | **Delivery** |
| `booking_type === 'Package'` | **Event setup** |

Two words the business already uses, and the split it already makes. A short
order carries a `delivery_fee`; a package carries equipment.

### 4.2 The dispatch window

The heart of it. In `utils/vehicle.js`:

```js
// How long a vehicle is actually tied up, by trip type. These are the
// numbers to calibrate with PG's — they are the whole model, and they
// live here so a change is one edit, not a schema migration.
export const TRIP_PROFILE = {
  'Event setup': { leadHours: 2, serviceHours: 5, returnHours: 1 },
  Delivery:      { leadHours: 1, serviceHours: 0.5, returnHours: 0.5 },
};
export const TURNAROUND_HOURS = 1;   // back at base, unloaded, ready again

export function getDispatchWindow(assignment, booking)  // → { start, end, type }
export function windowsOverlap(a, b)                     // turnaround included
```

- `start` = the stored `dispatch_datetime` — already exists, already per-assignment.
- `end` = `event_datetime + serviceHours + returnHours`, by profile.
- Two dispatches conflict **only when their windows overlap**. Same-day,
  non-overlapping trips do not conflict. That single sentence is the fix.

`serviceHours` is a real estimate — there is no event-duration column and we are
not adding one. Naming it as a documented constant is honest. Burying the same
guess inside a `toDateString()` comparison, as today, is not.

### 4.3 How many vehicles a booking needs

`equipment_type` only ever holds `'Countable'` or `'Decoration'`, so there is no
volume or bulk figure in the schema to sum. Sizing comes from what a caterer
actually thinks in — guests — with the allocated equipment count as a check:

```js
export const FLEET_SIZING = {
  eventSetupByPax: [
    { maxPax: 50,       vehicles: 1 },
    { maxPax: 150,      vehicles: 2 },
    { maxPax: Infinity, vehicles: 3 },
  ],
  // One more vehicle per this many allocated units beyond the band, so a
  // 40-pax event with a full decoration set isn't under-served.
  unitsPerExtraVehicle: 250,
  delivery: { vehicles: 1, preferType: 'Motorcycle' },
};
```

Equipment allocates at approval **before** this runs, so the
`booking_equipment` rows are already there to count. This is where Vaughn's "as
long as equipment is enough and allocated properly" becomes literal: **the
equipment allocation sizes the fleet need.**

### 4.4 Auto-assignment

`suggestDispatchPlan(booking, fleet, assignments)` returns a plan a manager can
read, not a silent write:

```js
{
  tripType: 'Event setup',
  vehiclesNeeded: 2,
  dispatchAt: '2026-09-14T06:00',
  picks: [
    { plate_number: 'ABC 123', reason: 'Free 06:00–14:00, no other trip' },
    { plate_number: 'XYZ 789', reason: 'Free all day, least used this week' },
  ],
  shortfall: null,          // or { needed: 3, found: 2, blockedBy: [...] }
}
```

Selection order, so identical inputs always give an identical plan:

1. `vehicle_status === 'Available'` only — never a Maintenance or Unavailable unit.
2. No overlapping window (§4.2), turnaround included.
3. Prefer the type the profile asks for — a Motorcycle for a delivery.
4. Then **fewest trips in the last 7 days**, spreading wear instead of always
   picking the same van.
5. Then plate number, so ties break the same way every time.

---

## 5. The page, screen by screen

Four tabs stay. What changes is which question each one answers.

### 5.1 Header

`Manage Fleet` opens the *Add vehicle* modal — the label promises a fleet
manager and delivers a create form. It becomes **Add vehicle**; managing the
fleet is what the Fleet tab is for.

`Assign Vehicle` → **Assign vehicles** (the modal is multi-select) and gains a
sibling: **Needs a vehicle (n)**, which is the thread missing from moment 3 —
approved events with no dispatch, in date order, one click to plan each. If
auto-allocation is switched on this counter normally reads zero, and the day it
doesn't is the day it earned its place.

### 5.2 Date bar and stat cards

The date bar is good and stays. The cards need two fixes.

**PR-28 is only half applied.** The table pills read Committed / Available,
correctly. The cards directly above them still read **"Vehicles deployed"** and
**"Vehicles free"**, and the tab description says "free/deployed status" — one
screen, two vocabularies for one idea, which is precisely what Blueprint 02 was
written to stop. The panel will read the cards before the pills.

Three cards, all scoped to the selected date:

| Card | Reads | Click |
|---|---|---|
| Events on this date | count of active bookings | the events modal, as now |
| **On the road** | vehicles with a dispatch window on this date | Availability, filtered |
| **Free** | vehicles with no window, minus out-of-service | Availability, filtered |

"On the road" replaces "deployed" because it survives the model change — under a
window model a vehicle can be on the road twice in a day, and "deployed" reads
like a state rather than an event.

### 5.3 Availability tab — the one that changes

Today: one row per vehicle, one status pill, one "Assigned to". That shape can
only express *one* trip, which is why it is the tab the window model breaks.

Becomes a **day timeline**. Each vehicle is a row; each dispatch is a block on
it, labelled with the event reference and the window. A row with two blocks and
a gap between them reads as what it is — busy twice, free in between. A row with
no blocks is free. A row greyed out is out of service.

This is the whole point of the change, made visible. A manager looking at
Saturday should see at a glance that the 6am wedding van is back by 11 and can
take the 2pm delivery, without doing the arithmetic themselves.

Below the timeline, the existing table stays for search and sort, with **one row
per trip** rather than per vehicle, and a Trip column showing Event setup or
Delivery.

### 5.4 Fleet tab

The register: plate, type, base status, actions. Two changes.

The **"Usage"** column shows `assignments.filter(a => a.assignment_status !==
'Completed').length` and labels it "3 in use" — but a van booked for a wedding
three weeks out is counted in that three. It is not in use; it is committed.
Same defect as D8, in miniature. Becomes **"Trips booked"**, counting forward
dispatches, with "On the road" only when a window contains now.

**Base status** is right and worth keeping — it is the vehicle's own condition,
independent of any date, and the word "Base" is what stops it being confused
with the date-scoped Status column on the Availability tab.

### 5.5 Active Assignments

Grouped by event, overdue first, expandable, with Return all. This is the best
part of the page and stays. It gains the trip type on each group and the
dispatch window on each row instead of just a dispatch time, so a manager can
see what "returned" is being measured against.

### 5.6 History

The full log. Gains a Trip column, and per D4 stops going blank on past dates.

### 5.7 Sidebar

Needs Attention (out-of-service vehicles) and Overdue Returns, both live rather
than date-scoped, both drilling into the right tab pre-filtered. Correct as
built; unchanged.

### 5.8 Booking and Short Order detail pages — **BUILT 30 Aug 2026**

`BookingDetails.jsx` and `ShortOrderDetails.jsx` mention a vehicle **only in
the delete warning**. There is no way to look at a booking and see what is
carrying it. Each gains a Dispatch section — assigned vehicles, dispatch time,
trip type, and an Assign button when there are none. Small, and it closes the
loop: the booking knows its vehicle, not just the vehicle knowing its booking.

---

## 6. Guardrails

Same table Equipment got, so the two pages can be checked against each other.

| Guardrail | Where | Status |
|---|---|---|
| Returns open 3 h after the event starts | `getReturnAvailability`, both return handlers, the Lock icon | Correct today |
| Assign: vehicle free **for the trip window** | `addToQueue`-equivalent and `handleAssignSubmit` | **Today: locks the whole day (D1)** |
| Assign: the picker greys out what the handler would reject | `Vehicles.jsx:2136` | Must change with D1, or they disagree |
| Out of service blocked while dispatched | `handleEditSubmit`, `handleFlagIssueSubmit` | Correct, and names the events |
| Delete blocked by active assignments | `handleDeleteVehicle` | **Runs after the password (D10)** |
| Delete does not destroy history | — | **Missing (D10)** |
| Approve blocked/warned when no vehicle is free | `ApprovalAvailabilityCheck.jsx` | **Missing (D5)** |

---

## 7. What is wrong now

Twelve defects, ordered by damage. D1–D9 are the dispatch model; D10–D12 came
out of the page sweep.

**D1 · The whole-day lock** — `Vehicles.jsx:611`, and again at `:2136`.

```js
return new Date(a.booking.event_datetime).toDateString() === eventDate.toDateString();
```

Any non-completed assignment on the same calendar date blocks a new one. This is
what caps the business at three events a day. The **same rule is written twice**
— the second copy greys out the checkbox in the Assign modal's picker, so both
must change together or the UI will disable a vehicle the handler would accept.
It is stated as deliberate at `Vehicles.jsx:404-408`:

> "unlike equipment (a shared stock pool where two non-overlapping dates can
> reuse the same units), there's no 'it's actually fine' case here."

Right that a vehicle is one indivisible unit; wrong about the time axis. A
vehicle is exclusive for the duration of a trip, not for twenty-four hours.

**D2 · A same-day second trip is invisible** — `utils/vehicle.js:88`.
`assignByVehicle[a.vehicle_id] = {...}` is one slot per vehicle, so a second
trip silently overwrites the first. The Availability tab, its pills and its
three counts all read this object, so the moment D1 lifts the page starts
under-reporting. **D2 must be fixed in the same change as D1**, not after it.

**D3 · The snapshot is keyed on the event date, not the dispatch.** A van going
out 9 Aug 22:00 for a 10 Aug 06:00 event reads as free all day on the 9th — the
night it is actually on the road.

**D4 · A returned trip disappears from the day** — `utils/vehicle.js:85`,
`.neq('assignment_status', 'Completed')`. Look at yesterday and every vehicle
reads Available, because every trip closed. For a past date the honest answer is
what happened, not what is free.

**D5 · Approval never checks vehicles.** §3, moment 2.

**D6 · Vehicles never auto-allocate, though equipment does.** §3, moment 3.

**D7 · Trip type does not exist.** A forty-minute delivery and a 200-pax wedding
set-up are the same row, and the dispatch suggestion at `Vehicles.jsx:284` is a
flat 2 hours before the event for both.

**D8 · "Currently Dispatched" counts the future** —
`Reports/VehicleUtilizationTab.jsx:28`. A van booked for a wedding three weeks
out is `Scheduled`, so it reports as dispatched *today*, and the utilization
percentage beside it is a utilization of nothing. Same class of error as
Blueprint 01's money defects: a real number under a label describing a different
number.

**D9 · Unbounded queries — the PostgREST 1000-row cap.** Six selects with no
`.range()`: `Vehicles.jsx:185, 192, 204` and `utils/vehicle.js:40, 48, 82`.
`vehicle_assign` grows without bound; three vehicles doing a few trips a day
reaches 1,000 rows inside a year, and then History starts silently dropping its
oldest rows. Same defect the panel hit on Payments (PR-19).

**D10 · Delete asks for the password before checking whether it can delete** —
`Vehicles.jsx:527`. `showConfirm`, then `requestPasswordConfirm`, and only then
the active-assignment check. The manager confirms, types their password, and is
*then* told no. This is the exact defect fixed on Equipment on 21 Aug; Vehicles
was out of scope at the time and never came back.

Worse, once it passes it runs `.delete().eq('vehicle_id', ...)` across **all**
of `vehicle_assign`, completed trips included. Retiring an old van silently
erases every dispatch it ever made — rows the reports read from. Equipment
blocks deletion when history exists; Vehicles wipes it without saying so.

**D11 · PR-28 is half applied.** §5.2.

**D12 · "Usage" counts commitments as use.** §5.4.

---

## 8. Build order

Each phase leaves the tree working.

**Phase 1 — model and correctness. DONE 28 Aug 2026.**
`utils/vehicle.js` gained `TRIP_TYPE`, `TRIP_PROFILE`, `TURNAROUND_HOURS`,
`getTripType`, `getDispatchWindow`, `windowsOverlap`, `windowIntersectsDay`.
D2, D3, D4, D9 and D10 are closed. `getDailyVehicleSnapshot` now returns an
`assignments` **array** per vehicle — sorted by dispatch time, so a row reads
left to right as that vehicle's actual day — matched on the dispatch window
rather than the event date, with completed trips kept. All ten reads across the
two files page through `fetchAllRows`, each `.order()` ending on a primary key.

Two things worth knowing about the delete guard: both blocking checks now run
**before** the confirm and the password, and a vehicle with any dispatch
history can no longer be deleted at all. It used to wipe every
`vehicle_assign` row for that vehicle, which is what the utilization reports
read from. Retiring a vehicle is Flag issue → Unavailable; deletion is only for
one that never went anywhere.

**Phase 2 — lift the lock, allocate at approval. DONE.** Replace the `toDateString()`
check at `:611` *and* its twin at `:2136` with the overlap test. Add
`suggestDispatchPlan` and `allocateVehiclesForBooking`. Wire the fleet check
into `ApprovalAvailabilityCheck.jsx` (D5) and the allocation into
`useApprovalHandlers.js` (D6). **Needs §9 answered first.**

**Phase 3 — the screens. DONE 30 Aug 2026.** The Availability timeline, trip type through
Assignments and History, the card and column wording (D11, D12), the Dispatch
section on both detail pages, `Needs a vehicle`.

**Phase 4 — reports. DONE 30 Aug 2026.** Fix D8: scope "Currently Dispatched" to windows
containing now, and make utilization vehicle-hours dispatched over vehicle-hours
available across the report range — a percentage of a whole, which is the rule
Blueprint 02 §4 set.

---

## 9. Decisions needed before Phase 2

**9.1 · Does approval assign vehicles automatically, or propose them?**
Recommended: propose in the approval panel, commit when the manager presses
Approve. The alternative — silent insertion, exactly matching equipment — is
more consistent, but it commits a scarce physical thing without anyone looking
at it, and nobody goes hunting for a problem they don't know exists.

**9.2 · The trip profile numbers.** `serviceHours: 5` for a setup and `0.5` for
a delivery are my estimates, not PG's. They decide how many trips a day the
system permits, so they are worth one conversation with the client. If the real
answer is "it depends", the constants stay and we take the conservative end.

Phase 1's tests made the sensitivity concrete, and it is sharper than expected:
at `serviceHours: 5`, a van dispatched 06:00 for an 08:00 event is not free
again until **14:00**, plus turnaround. So one vehicle realistically does two
trips a day, not four. Set this number too high and the whole-day lock comes
back by arithmetic instead of by `toDateString()`; too low and the system will
promise a van that is still at a venue. It is the single most consequential
constant in the file.

**9.3 · Fleet sizing bands.** Is a 120-guest event two vans at PG's, or one van
twice? Both are expressible; §4.3 has to say which.

**9.0 · SETTLED, 30 Aug 2026 — `vehicle_assign` has no unique constraint on
booking+vehicle.** The table carries `fk_va_booking`, `fk_va_manager`,
`fk_va_vehicle` and `vehicle_assign_pkey` on `assignment_id`, and nothing else.
A booking can therefore hold both a setup row and a pickup row for the same
vehicle, and §4.2's derived-leg model persists as designed. The code had
asserted the opposite in a comment and carried a defensive `pickupsSkipped`
path for it; the comment is corrected and that path now reads as what it is —
a genuine failure branch, not an expected limitation.

**9.4 · Can one vehicle serve two events on one run?** Dropping equipment at two
venues in a single trip is a real thing caterers do. It is impossible today (one
`vehicle_assign` row per booking) and would stay impossible under this plan. If
PG's does it, say so now — it changes the overlap rule from "never" to "only
within one run", which is a different model, not an adjustment.

---

## 10. Out of scope, and worth saying so

- **No driver.** There is no driver or staff table, so the system will keep
  saying a van is free when the person who drives it is not. Out of bounds while
  the no-schema-changes rule holds — worth naming to the panel before they ask.
- **No departure or return timestamp.** `vehicle_assign` records *that* a trip
  finished, never when. Planned-versus-actual turnaround therefore cannot be
  measured, and window ends stay estimates.
- **`vehicle_type` carries no capacity.** Car and Motorcycle are the only
  values; sizing works from pax and equipment counts instead (§4.3).
