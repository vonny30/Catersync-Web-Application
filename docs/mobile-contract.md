# The shared-database contract

Three apps write to one Supabase project: this admin web app, the Operations
Manager mobile app, and the Kitchen Staff mobile app. (A customer-facing mobile
app shares it too — `panel-revisions-2026-05-29.md` §4 covers that one.)

Nothing in the database enforces the rules below. They are enforced by every
client agreeing to them, which is why they are written down here rather than
left in each codebase's head. **This file is the source of truth. When a rule
here changes, it changes here first, and every client follows.**

Drafted 29 Aug 2026, from the admin web app. It states what the web app does
and therefore expects. It has **not** been checked against either mobile
codebase — nobody working on this file has seen them. Anywhere the mobile apps
already disagree, the disagreement is a bug in one of the two, and this document
is where we decide which.

---

## 0. Read this first if you are updating a mobile app this week

Four things changed in the admin app on 28–29 Aug 2026 that **break an
Operations Manager app which touches `vehicle_assign`**. They are not
theoretical; they are live in the database now.

| # | What changed | What breaks |
|---|---|---|
| 1 | A booking can now hold **two** `vehicle_assign` rows per vehicle | Every job list shows each job twice; every "N vehicles" count doubles; any `.single()` on (booking_id, vehicle_id) now throws |
| 2 | Vehicles are **auto-assigned when a booking is approved** | If the ops app also creates assignments on approval, you get duplicates |
| 3 | "Is this vehicle free" is now a **time-window** test, not a same-day test | A mobile availability check using a date comparison will refuse dispatches the web allows, and allow ones it refuses |
| 4 | A vehicle with **any** dispatch history can no longer be deleted | A delete button that used to work now returns a blocked message |

§3 explains each. If you read nothing else, read §3.1.

---

## 1. Stored values are the contract. Labels are not.

The single most common way these apps break each other is one of them writing
a **display label** into a column that stores a **fixed value**, or comparing
against a label.

Stored values, exact and case-sensitive:

| Column | Allowed values |
|---|---|
| `booking.booking_status` | `Pending`, `Approved`, `Confirmed`, `Completed`, `Rejected`, `Cancelled` |
| `booking.booking_type` | `Package`, `Short Order` |
| `payment.pay_status` | `Downpayment`, `Fully Paid`, `Pending Verification`, `Proof Rejected` |
| `vehicle.vehicle_status` | `Available`, `Maintenance`, `Unavailable` |
| `vehicle_assign.assignment_status` | `Scheduled`, `Completed` |
| `equipment.eqm_status` | `Available`, `Under Maintenance` |
| `equipment.equipment_type` | `Countable`, `Decoration` |
| `vehicle.vehicle_type` | `Car`, `Motorcycle` |

The admin app relabels several of these on screen and **never** writes the
label back. Some examples, so a mobile screen can match the wording without
copying it into the database:

| Stored | Shown to a manager |
|---|---|
| `assignment_status: 'Scheduled'` | **Assigned** before the event, **In Use** once it has started |
| `assignment_status: 'Completed'` | **Returned** |
| `pay_status: 'Fully Paid'` | **Fully Paid** — but the *tab key* in the web UI is still `Full Payment`; don't copy the key |
| `vehicle_status: 'Maintenance'` | **Under Maintenance** |

The mapping lives in `src/utils/statusLabels.js`. It takes a boolean and a
date, never a stored string — that boundary is the point of the file.

## 2. `status_order` must be written with every `booking_status`

`booking.status_order` is a real column that exists only so the web list can
sort Pending → Approved → Confirmed → Completed → Rejected → Cancelled.
PostgREST cannot `ORDER BY` a CASE expression, so the order has to be stored.

**Nothing in the database maintains it.** Any client that writes
`booking_status` must write the matching number in the same update:

```
Pending 1 · Approved 2 · Confirmed 3 · Completed 4 · Rejected 5 · Cancelled 6
```

This has already gone wrong in production: three Confirmed bookings carried
`status_order` 5 and a Cancelled one carried 4, so they interleaved with
Rejected and Completed rows in the manager's list. It is the single most likely
way a mobile app silently corrupts the web UI, because the write succeeds and
nothing anywhere complains.

Related, and equally unenforced:

- **Customer cancels → `Cancelled` (6). Manager rejects → `Rejected` (5).**
  They are different actions and must not be collapsed.
- Marking a booking **Completed** must also close its resources: set every
  `booking_equipment.returned = true` and every `vehicle_assign.assignment_status
  = 'Completed'` for that booking. The web does this in one place
  (`useCompletionHandlers.js`); a mobile app that sets the status alone leaves
  equipment and vehicles looking permanently committed.
- **Cancelling deletes** that booking's `booking_equipment` and `vehicle_assign`
  rows outright. If a mobile screen is holding those rows, it must refetch.

## 3. Vehicles — what changed this week

### 3.1 A booking now holds up to TWO trips per vehicle

A vehicle does not sit at the venue through an event. It travels, unloads, sets
up, and leaves — which is exactly why PG's three vans can cover two events
starting at the same hour. So one booking produces two runs:

- **Setup run** — leaves base, travels, sets up. Finishes *by* the event start.
- **Pickup run** — goes back afterwards to collect. Starts 3 hours after the
  event begins, matching the existing rule for when a return may be recorded.

A **Short Order delivery has no pickup run** — nothing is left behind.

Both are ordinary `vehicle_assign` rows. **There is no column saying which is
which.** The leg is derived, and every client must derive it the same way:

```
dispatch_datetime <  booking.event_datetime  →  Setup run
dispatch_datetime >= booking.event_datetime  →  Pickup run
```

That derivation is why no schema change was needed. It is also why a mobile
list that assumes one row per (booking, vehicle) is now wrong. Concretely, in an
Operations Manager app:

- A driver's job list shows the same event twice unless the two rows are
  labelled Setup and Pickup, or grouped.
- Any count of "vehicles assigned to this event" must count **distinct
  `vehicle_id`**, not rows. The web made exactly this mistake and it was fixed by
  a shared `countDistinct` helper.
- Any query written as `.eq(booking_id).eq(vehicle_id).single()` now throws,
  because it matches two rows.

### 3.2 Availability is a trip window, not a calendar day

The admin app used to block a vehicle for the whole day once it had any
assignment. That capped the business at three events a day and has been removed.
A vehicle is now unavailable **only for the span of a run**, plus a gap.

If the ops app has its own "can I dispatch this van" check, it must use the same
test or the two will disagree — and disagreeing is worse than either rule alone,
because the manager sees one answer on the phone and another on the laptop. The
web's implementation is `getDispatchWindow` and `tripsConflict` in
`src/utils/vehicle.js`. The constants that define the windows
(`TRIP_PROFILE`, `HOP_HOURS`, `TURNAROUND_HOURS`, `PICKUP_GRACE_HOURS`) live at
the top of that file and are meant to be tuned with PG's. **If mobile
reimplements the maths, these numbers must be kept in step by hand** — which is
an argument for mobile reading availability from the web's rules rather than
duplicating them.

### 3.3 Approval assigns vehicles automatically

Approving a booking now allocates its equipment **and** its vehicles, in that
order — the fleet is sized partly from the equipment just allocated. Ordering
when one van serves two events is by **approval order**: whatever was approved
first is set up first.

If the ops app assigns vehicles at approval too, remove that — you will get
duplicate rows. Assigning *manually afterwards* is fine and expected; that is
what the Vehicles page is for.

### 3.4 A vehicle with history cannot be deleted

Deleting a vehicle used to delete all of its `vehicle_assign` rows, which are
what the utilization reports are built from. It is now blocked. Retiring a
vehicle is `vehicle_status: 'Unavailable'`. A mobile delete action should say
the same thing rather than failing on a foreign key.

## 4. Equipment

- Equipment is **auto-allocated at approval** from the package template and the
  pax count. A mobile app should not allocate it again.
- The stock identity is `total = usable + out of service` and
  `available = usable − committed`, where usable is `quantity_available`,
  out of service is `damaged_quantity + maintenance_quantity`. Never
  reconstruct a total by hand; `quantity_available` is **not** the total.
- Returns open **3 hours after the event starts**, not at the event end. Same
  rule for vehicles.

## 5. Reading data at all: the 1000-row cap

PostgREST caps every response at 1000 rows and returns the truncated set **with
no error**. Nothing throws, nothing warns. Any screen computing a total from an
unbounded `.select()` is correct only until the table crosses that line, and
quietly wrong after.

This has already caused a real defect the panel raised: the web's "Fully Paid"
count disagreed with the records behind it.

Every client must page any query that can grow: bookings, payments,
`vehicle_assign`, `booking_equipment`. The web's helper is
`src/utils/fetchAllRows.js`, and it has two rules worth copying: supply a
**stable** `.order()` ending on a primary key, and pass a query *factory*, since
a PostgREST builder is single-use.

`vehicle_assign` is the table most likely to cross 1000 next — it now grows by
**two rows per booking per vehicle**, not one.

## 6. Money

One rule, because three different answers to "how much have we collected"
appeared once already:

- Cash figures anchor on `payment.pay_datetime`. Event figures anchor on
  `booking.event_datetime`. They are different questions and must not share a
  label.
- `Pending Verification` and `Proof Rejected` payments are **not** collected
  money and must never be summed into a total.
- A forfeited downpayment on a cancelled booking is real cash but is not live
  business — the web reports it on its own line.

## 7. Keeping this honest as we keep updating

1. **This file changes first.** Any change to a shared table's meaning — a new
   stored value, a new derived rule, a new row-per-booking assumption — is
   written here before it is coded anywhere.
2. **Both mobile repos should carry a copy or a link.** Whichever assistant is
   working in them reads this before touching a shared table.
3. **Every change that adds rows to a shared table gets a line in §5**, because
   the row cap is the failure nobody sees.
4. When the two disagree, **neither side "wins" by being newer** — the question
   is which one matches what PG's actually does, and that is a question for
   Vaughn, not for either codebase.

## 8. What this document does not yet cover

Honest gaps, because nobody has seen the mobile code:

- **The Operations Manager app's actual screens and writes.** Whether it
  creates assignments, records returns, edits equipment, or only reads.
- **The Kitchen Staff app entirely.** Presumably it reads the day's bookings and
  their menu selections to produce the kitchen list. Which tables it writes, if
  any, is unknown here — and if it writes `booking_status` at all, §2 applies to
  it immediately.
- **Auth and roles.** How the two apps authenticate and what row-level security
  applies to them.
- **`menu_selections` stores only `{menu_item_id, quantity}`** — no price
  snapshot. Tray counts are exact; peso figures are always derived. That matters
  most to a Kitchen Staff app, and is worth confirming against what it displays.

Filling these in needs the repos.
