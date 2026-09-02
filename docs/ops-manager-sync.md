# Operations Manager app ↔ Equipment and Vehicles

The integration spec for the Operations Manager mobile app. Written 31 Aug 2026
against the live admin tree, for whoever builds the OM side.

**This is the contract, not a suggestion.** Both apps write to one Supabase
project and nothing in the database enforces the rules below — they hold only
because every client follows them. Where the OM app derives something the web
already derives, it must derive it **the same way**, or the manager sees one
answer on the laptop and the driver sees another on the phone.

Read `mobile-contract.md` first for the rules common to every client. This
document is only the Equipment and Vehicles surface.

---

## 0. Status — read this before you build against anything below

**This file is maintained.** Any change to the Equipment or Vehicles pages, or
to `utils/vehicle.js` / `utils/equipment.jsx`, is not finished until this
document reflects it. So the version below is the one to trust, and §0.2 is the
short answer to "what changed since I last read this?".

### 0.1 Current values — check these first

If the OM app has different numbers hard-coded, it is out of date and its
itinerary will disagree with the manager's screen.

| Constant | Value | Where |
|---|---|---|
| `TRIP_PROFILE['Event setup']` | travel 1h · setup 3h · teardown 1h · has collection run | `utils/vehicle.js` |
| `TRIP_PROFILE['Delivery']` | travel 0.5h · setup 0.25h · teardown 0 · no collection run | `utils/vehicle.js` |
| `PICKUP_GRACE_HOURS` | **4** | `utils/vehicle.js` |
| `HOP_HOURS` | **1.5** | `utils/vehicle.js` |
| `TURNAROUND_HOURS` | 1 | `utils/vehicle.js` |
| `TRIP_LEG` | `Setup run` / `Collection run` | `utils/vehicle.js` |
| `PICKUP_VENUE_MARKER` | `Pickup - Main Branch` | `utils/vehicle.js` |
| `FREE_DELIVERY_AREAS` | Bayawan · Santa Catalina · Basay | `utils/vehicle.js` |
| Equipment return opens | event start + `PICKUP_GRACE_HOURS` | `pages/Equipment.jsx` |
| Equipment return due | event start + 24h, then Overdue | `pages/Equipment.jsx` |

### 0.2 Changelog

Newest first. Anything marked **breaking** means an OM app built before that
date needs a change, not just a re-read.

| Date | Change | Effect on the OM app |
|---|---|---|
| 2 Sep 2026 | **Schema decision settled**: `return_log` and `booking_equipment.returned_quantity` approved | §5.3's remaining blocks lift once the migration lands. Build the return checklist all-or-nothing per item until then, then extend it — do not invent a workaround store. |
| 1 Sep 2026 | `staff_account`, `kitchen_task_status` and `is_main_cook()` confirmed **live** in the database; §1.3, §5.3 and §8 corrected — **OM authentication is buildable**, following the main-cook pattern (§2.1) | **Breaking.** This file previously said the OM could not log in and that the app was blocked before any screen rendered. Both were wrong. Anyone who read it before this date holds the opposite belief |
| 31 Aug 2026 | This document created; §1 role definition added | — |
| 30 Aug 2026 | Short-order **service method** added — `PICKUP_VENUE_MARKER`, `getServiceMethod`, `FREE_DELIVERY_AREAS` | **Breaking.** A customer pickup gets no vehicle and must not appear on an itinerary. §3.5 |
| 30 Aug 2026 | `PICKUP_GRACE_HOURS` 3 → **4**; `HOP_HOURS` 0.75 → **1.5**; event-setup `setupHours` 1.5 → **3** | **Breaking.** Both the collection-run departure and the return-checklist unlock moved by an hour. §3.2 |
| 30 Aug 2026 | `TRIP_LEG` renamed `Setup`/`Pickup` → **`Setup run`/`Collection run`**; a short order's outbound leg is labelled **Delivery** | **Breaking** if the app stores or compares leg names. §3.1 |
| 29 Aug 2026 | Vehicles allocated automatically when the Manager approves a booking | The itinerary is populated without anyone assigning by hand |
| 28 Aug 2026 | A booking now holds **two** `vehicle_assign` rows per vehicle — setup and collection — with the leg **derived** from the dispatch time | **Breaking.** Every count, every job list, every `.single()`. §3.1 |
| 28 Aug 2026 | Vehicle availability became a **trip-window** test, not a same-day test | A van can serve two events in one day. §3.2 |

### 0.3 What must trigger an update to this file

Any of these, on the web side:

- A `TRIP_PROFILE`, `HOP_HOURS`, `TURNAROUND_HOURS` or `PICKUP_GRACE_HOURS` value changes → update §0.1 **and** §3.2
- The setup/collection leg derivation changes → §3.1
- A new column is used on `vehicle_assign`, `booking_equipment`, `equipment` or
  `vehicle`, or a stored value is added to any status column → §2
- The stock identity changes → §3.4
- The return-grace or return-due rule changes → §3.2, §5.1
- A guard is added that the OM app would also need to respect → §5, §7
- The service-method or free-delivery rules change → §3.5
- Anything in §5.3 becomes unblocked → §5.3 and the §1.3 table

Add a row to §0.2 for anything marked breaking above, and say plainly what the
mobile side has to do about it. A changelog entry that only says what changed on
the web is half an entry.

---

## 1. The role, and what the app has to let them do

### 1.1 Who the Operations Manager is

**One person.** The capstone's §1.1 lists PG's staff as one booking staff, **one
operations manager**, four kitchen staff, ten on-call servers, and three cars
plus two motorcycles. So there is no queue of operations staff competing for the
same job — but there IS competition with the Manager on the web app, who is
moving the same vans and the same stock at the same time. Section 6 is about
that.

The role, in one line:

> **The Operations Manager owns the physical movement of things.** The Manager
> decides what is promised; the Operations Manager makes sure it gets there and
> comes back.

That boundary is the whole design. Everything the OM does is downstream of a
booking somebody else already approved.

### 1.2 The two problems this app exists to solve

Both are named in the capstone's §1.1 as things PG's does badly today:

1. **"They also don't have a specific list of equipment that they need to pack,
   and thus equipment is left or not taken to out-of-town venues."** There is no
   packing list. The OM loads the van from memory.
2. Nothing records what came back. Losses surface later, unattributed, as stock
   that no longer adds up.

§1.4 states the intent: *"To help prevent equipment missing and enhance event
preparation, it can provide a checklist of supplies required for delivery and
event setup."*

So the app is a **packing list and a return record**, wrapped around a schedule.
If it does only those two things well it has done its job.

### 1.3 Everything the Operations Manager should be able to do

From UFR-OM-01…06, SFR-OS-01…06, and the WBS (Fig 4.2.1.5). "Buildable" means
against the schema as it exists today — see §5.3 for the three that are blocked.

| # | The OM should be able to… | Screen | Read/Write | Buildable now |
|---|---|---|---|---|
| **Account (WBS 4.1)** ||||
| A1 | Log in as themselves | Login | — | **Yes** — `staff_account` + Supabase auth already exist (§2.1) |
| A2 | See and edit their own contact number, change password | Profile | W | **Yes** — with A1 |
| A3 | Log out | Profile | — | **Yes** — with A1 |
| **Delivery assignments (WBS 4.2 · UFR-OM-01, 04, 05)** ||||
| D1 | See the vehicles assigned to them for the day | Today's Operation Tasks | R | **Yes** — §4.1 |
| D2 | See the delivery schedule — what leaves when, in order | Today's Operation Tasks | R | **Yes** — §3.3 |
| D3 | See every event assigned, not just the next one | Today's Operation Tasks | R | **Yes** |
| D4 | Pick any date and see that day's trips | Calendar filter | R | **Yes** |
| D5 | See the delivery address and the customer's contact number | Event detail | R | **Yes** — §4.3 |
| D6 | See what food is going out with the trays | Food List | R | **Yes** — §4.3 |
| D7 | Update delivery / dispatch status | Event detail | W | **Partial** — only the two values `assignment_status` holds; see §8 |
| **Equipment monitoring (WBS 4.3 · UFR-OM-02, 03, 06)** ||||
| E1 | See the exact packing list for a venue | Packing List | R | **Yes** — §4.2 |
| E2 | Tick items back in after the event | Return Checklist | W | **Yes** — §5.1 |
| E3 | Record a **partial** return (47 of 50 chairs) | Return Checklist | W | **No** — §5.3 |
| E4 | Report items missing | Return Checklist | W | **No** — §5.3 |
| E5 | Report items damaged | Return Checklist | W | **No** — §5.3 |
| E6 | See a completed event's return summary | Completed Summary | R | **Yes** |
| E7 | See the history of past dispatches, deliveries and checklists | History | R | **Yes** |

**All nine reads are buildable against the schema as it stands**, and so is the
whole account group. The writes are where it stops: A1–A3 and E2 work today, D7
works only as far as the two values `assignment_status` holds, and E3, E4 and E5
are blocked on the single decision in §5.3.

> **Corrected 1 Sep 2026.** A1 was previously marked **No — no staff table**,
> and this paragraph said A2 was blocked on an account that did not exist. Both
> were false: `staff_account` is live and `is_main_cook()` already drives RLS
> policies in production. See §2.1. If you read this file before 1 Sep, the
> account screens you were told to defer are buildable now.

So the app's whole read surface — the itinerary, the packing list, the food
list, the history — plus login and profile, can be built now, and that is
already most of what §1.2 says the app is for.

### 1.4 What the Operations Manager must NOT be able to do

Worth stating, because the app shares a database with the web app. These can be
**enforced**, not merely agreed: `staff_account.role` exists and RLS is live on
every table, so an `is_operations_manager()` policy set (§2.1) can refuse each
of these at the database rather than trusting the app not to offer the button.

Until those policies are written they are conventions — so build the app as if
they were enforced, and write the policies as soon as the role predicate lands.
Nothing below should ever be a button the OM can press.

- **Not approve, reject, confirm or cancel a booking.** The Manager owns the
  lifecycle. The OM never writes `booking_status` — and therefore never has to
  touch `status_order`, which is the single most common way a client corrupts
  the web list.
- **Not assign or reassign vehicles.** Vehicles are allocated when the Manager
  approves the booking. The OM sees the result and executes it.
- **Not edit stock.** `equipment.quantity_available`, `damaged_quantity` and
  `maintenance_quantity` are the Manager's. The OM reports what happened;
  adjusting stock in response is a Manager decision. (This is exactly why E4 and
  E5 need their own table rather than writing to `equipment` — see §5.3.)
- **Not record or verify payments.** Nothing in the OM's job touches money, and
  no operations screen should display a peso figure at all (§4.3).
- **Not delete anything.**

### 1.5 A day, in order

The three screens map onto the shape of an actual working day:

| When | Screen | What happens |
|---|---|---|
| Morning | Today's Operation Tasks | Reads the itinerary: how many trips, which vans, in what order |
| Before each departure | Packing List | Loads the van against the list. This is the piece of paper that doesn't exist today |
| At the venue | Event detail | Address, contact number, what food is with the trays |
| 4h+ after the event starts | Return Checklist | The collection run departs and the checklist unlocks — same constant, §3.2 |
| On return | Return Checklist → Submit | Ticks items back in; the Manager's Equipment page updates live (§6) |
| Any time | History | What was dispatched and returned, previously |

Three screens, from the capstone (Fig 4.2.4.34 – 4.2.4.38):

| Screen | Answers | Source |
|---|---|---|
| Today's Operation Tasks | "Where am I going, in what order?" | `vehicle_assign` + `booking` |
| Event Equipment / Packing List / Food List | "What goes on the van?" | `booking_equipment` + `equipment` + `menu_selections` |
| Return Checklist → Completed Summary | "What came back, what didn't?" | `booking_equipment` (writes) |

### 1.6 A naming inconsistency to settle

The capstone calls this role **Operations Manager** in §1.2, §1.4, the WBS and
every screen figure — but the DFD narrative for Process 6.0 calls the same actor
**"Dispatch Staff"** twice ("...to generate the packing list and delivery
schedule for the **Dispatch Staff**"). One role, two names, in one document. Pick
Operations Manager and fix the DFD text; the panel reads those figures.

---

## 2. The tables, and exactly which columns

Nothing here is new. Every column below already exists and the web app already
reads or writes it.

```
vehicle            vehicle_id, plate_number, vehicle_type, vehicle_status
vehicle_assign     assignment_id, vehicle_id, booking_id,
                   dispatch_datetime, assignment_status
booking            booking_id, booking_number, booking_type, booking_status,
                   event_datetime, venue, pax_count, notes,
                   delivery_fee, menu_selections, customer_id
booking_equipment  assignment_id (PK), booking_id, equipment_id, quantity,
                   returned, returned_at, assigned_at, notes
equipment          equipment_id, eqm_name, eqm_description, equipment_type,
                   quantity_available, damaged_quantity, maintenance_quantity,
                   pax_per_unit
customer           customer_id, first_name, last_name, contact_no, cus_address
```

**Stored values are the contract; labels are not.** Never write a display label
into a column, never compare against one:

| Column | Stored values | Shown as |
|---|---|---|
| `vehicle_assign.assignment_status` | `Scheduled`, `Completed` | Assigned → In Use → Returned |
| `vehicle.vehicle_status` | `Available`, `Maintenance`, `Unavailable` | Available / Under Maintenance / Unavailable |
| `booking.booking_status` | `Pending`, `Approved`, `Confirmed`, `Completed`, `Rejected`, `Cancelled` | as stored |
| `booking.booking_type` | `Package`, `Short Order` | Event setup / Delivery |
| `equipment.equipment_type` | `Countable`, `Decoration` | as stored |

Only `Approved` and `Confirmed` bookings are live work. A `Rejected` or
`Cancelled` booking's assignment is not a job and must never appear on an
itinerary.

### 2.1 Accounts and roles — the mechanism already exists

Verified against the live database, 1 Sep 2026. **The OM does not need a new
authentication mechanism inventing; it needs the running one extended.**

```
staff_account       user_id (PK, FK -> auth.users), display_name,
                    role (default 'main_cook'), active, created_at, updated_at
kitchen_task_status booking_id (PK), done, done_at, done_by (-> auth.users)
```

`is_main_cook()` is a Postgres function **already used in production RLS
policies** on `booking` and `customer` — the Main Cook's read of approved
bookings is enforced in the database, not in an app. So a staff member
authenticates through Supabase auth like anyone else, and `staff_account.role`
plus a role predicate decides what they can see.

For the Operations Manager, mirror it:

```sql
create or replace function is_operations_manager() returns boolean as $$
  select exists (
    select 1 from staff_account
    where user_id = auth.uid()
      and role = 'operations_manager'
      and active
  );
$$ language sql stable security definer;
```

Then policies scoped to what §1.3 says the role does — read the itinerary, the
packing list and the food list, update `booking_equipment.returned` and
`vehicle_assign.assignment_status` — and **nothing beyond it**. Specifically it
must not delete `booking_equipment` rows, change `equipment` stock totals, or
write `booking_status`; §1.4 is the list, and a policy is where it should be
enforced rather than trusted to the app.

This is a database change on a project three apps share. Additive policies for
a new role are low-risk; anything that narrows an existing one is not. Do it
with Vaughn and his groupmate present — and see landmine 9 before modelling
anything on the policies that are already there.

---

## 3. The five derivations the OM app must copy exactly

These are the rules that decide what the driver sees. All five live in
`src/utils/vehicle.js` and `src/utils/equipment.jsx` on the web side. **Port
them; do not reinvent them.** If any constant changes, it changes in one place
and both apps move together.

### 3.1 A booking has TWO trips, and which one is derived, not stored

There is no column saying whether a row is the outbound or the return run. The
dispatch time relative to the event start is what says it:

```
dispatch_datetime <  event_datetime   →  Setup run
dispatch_datetime >= event_datetime   →  Collection run
```

That derivation is the whole reason one booking can hold two `vehicle_assign`
rows with no schema change. It also means:

- **A job list will show each event twice** unless the two rows are labelled by
  leg. Label them.
- **Any "how many vehicles" count must count distinct `vehicle_id`**, never
  rows. The web made this exact mistake and fixed it with a shared
  `countDistinct` helper.
- **`.eq(booking_id).eq(vehicle_id).single()` now throws** — it matches two rows.

Leg names, per trip type — a short order is delivered and that is the end of it,
so its outbound leg is not called a "setup":

| Trip type | Outbound leg | Return leg |
|---|---|---|
| Event setup (Package) | **Setup run** | **Collection run** |
| Delivery (Short Order) | **Delivery** | *(none)* |

### 3.2 The trip window — when the van is actually busy

A van does **not** sit at the venue through the event. It travels, unloads, sets
up, and leaves; it comes back hours later for the equipment. That is why three
vans can cover events starting at the same hour.

```js
TRIP_PROFILE = {
  'Event setup': { travelHours: 1,   setupHours: 3,    teardownHours: 1, hasPickup: true  },
  'Delivery':    { travelHours: 0.5, setupHours: 0.25, teardownHours: 0, hasPickup: false },
};
HOP_HOURS = 1.5;            // reload at base between two runs
TURNAROUND_HOURS = 1;       // between unrelated trips
PICKUP_GRACE_HOURS = 4;     // event start → collection run departs
```

```
Setup run       [dispatch_datetime, + travelHours + setupHours]
Collection run  [event_datetime + PICKUP_GRACE_HOURS, + teardownHours + travelHours]
```

The setup run is timed so it **finishes** at the event start, never later.

**`PICKUP_GRACE_HOURS = 4` is load-bearing in two places at once** — it is when
the collection run departs *and* when a return may first be recorded. The two
must stay equal or the app will offer a checklist for a van that has not left,
or withhold one from a driver already at the venue.

### 3.3 The itinerary is trips, ordered by departure

The capstone already says "Today's Itinerary: **3 Trips**" — count trips, not
bookings. Order by `dispatch_datetime` ascending. A day reads:

```
06:00  Setup run        Karl Wedding @ Grand Hall      ABC-123
09:00  Delivery         Cruz Short Order @ Bayawan     XYZ-789
14:00  Collection run   Karl Wedding @ Grand Hall      ABC-123
```

### 3.4 The stock identity

Never reconstruct a total by hand. `quantity_available` is **usable stock, not
the total** — this was a real bug on the web page:

```
total     = quantity_available + damaged_quantity + maintenance_quantity
usable    = quantity_available
free      = usable − committed        (negative means "Short by N", do not clamp)
```

The OM app mostly needs per-booking quantities rather than stock, but any screen
that shows a fleet-wide figure must use this.

### 3.5 A short-order pickup gets no van

If the customer collects their own trays, there is no trip at all. The customer
app writes the collection point into `venue`:

```js
PICKUP_VENUE_MARKER = 'Pickup - Main Branch'
```

Matched as **that whole marker only** — tolerant of casing, spacing and
Pick-up/Pick up, nothing else. A loose "starts with pickup" rule would read
"Pickup point near the plaza, Bayawan" — a real delivery address — as a
collection and strand the customer.

Free-delivery municipalities, for fee sanity-checks only: **Bayawan, Santa
Catalina, Basay** (`Sta.`/`Sta` both match).

---

## 4. Reads — what each screen queries

Page every one of these. PostgREST truncates at 1000 rows with **no error**, and
`vehicle_assign` now grows two rows per booking per vehicle. Order must end on a
primary key so paging is stable.

### 4.1 Today's Operation Tasks

```sql
vehicle_assign
  select assignment_id, vehicle_id, booking_id, dispatch_datetime, assignment_status,
         vehicle:vehicle_id ( plate_number, vehicle_type, vehicle_status ),
         booking:booking_id ( booking_id, booking_number, booking_type, booking_status,
                              event_datetime, venue, pax_count, delivery_fee,
                              customer:customer_id ( first_name, last_name, contact_no ) )
  order by dispatch_datetime, assignment_id
```

Then in code: drop rows whose booking is not `Approved`/`Confirmed`, derive the
window (§3.2), keep those intersecting the chosen day, sort by window start.

**Sweep a day either side.** A van leaving 22:00 for a 06:00 event is on the
road tonight; filtering on `event_datetime` alone hides it.

Status per trip — **derived, there is no column**:

| Condition | Show |
|---|---|
| `assignment_status = 'Completed'` | Returned |
| now < window.start | Assigned |
| window.start ≤ now ≤ window.end | In Use |
| now > window.end, not completed | Overdue |

The mockup's "On Going / Completed" maps to In Use / Returned. Derive it; do not
invent a stored value.

### 4.2 Packing list (UFR-OM-02)

```sql
booking_equipment
  select assignment_id, equipment_id, quantity, returned, returned_at,
         equipment:equipment_id ( eqm_name, eqm_description, equipment_type, pax_per_unit )
  eq booking_id, <id>
  order by assignment_id
```

Group by `equipment_type` for the Equipments / Food Service sections in the
mockup. This list is created automatically when the manager approves the
booking, so it exists by the time any trip does.

### 4.3 Food list (UFR-OM-05)

`booking.menu_selections` — a JSON array of `{menu_item_id, quantity}`, joined
to `menu_item` for names. **`quantity` is a tray count and there is no price
snapshot.** Trays and pax are exact; any peso figure is derived. An operations
screen should show trays and pax and never money.

Delivery address is `booking.venue`; contact details come from the nested
customer.

---

## 5. Writes

### 5.1 Recording a return — works today

```sql
booking_equipment
  update { returned: true, returned_at: <now ISO> }
  eq assignment_id, <id>              -- one item
```

or for a whole event:

```sql
  update { returned: true, returned_at: <now ISO> }
  eq booking_id, <id>
  eq returned, false                  -- never re-stamp an already-returned row
```

Exactly what `Equipment.jsx:1121-1158` does. Match it.

**Guard first.** A return may only be recorded from `PICKUP_GRACE_HOURS` after
the event starts:

```js
opensAt = event_datetime + PICKUP_GRACE_HOURS hours
canReturn = now >= opensAt
```

Equipment is **due back within 24 hours** of the event start; past that it is
Overdue. Show the same sentence the web shows so the two apps do not describe
one policy in two ways.

### 5.2 Closing a vehicle trip — works today

```sql
vehicle_assign
  update { assignment_status: 'Completed' }
  eq assignment_id, <id>
```

Close the **collection run** when the equipment is back. Closing the setup run
early is harmless — availability is computed from windows, not from this column
— but it makes the History tab read wrongly, so don't.

### 5.3 What the OM app cannot write yet — unblocked 2 Sep 2026

> **Decision made.** Vaughn has approved adding `return_log` and
> `booking_equipment.returned_quantity`. Once the migration lands, both rows
> below become buildable and this section shrinks to nothing. Until then the
> checklist is all-or-nothing per item — build it that way rather than working
> around the gap, because the workaround would outlive the gap.

Two of the documented features have nowhere to land **yet**. The decision to
give them one is made (`blueprint-04-mobile-sync.md` §7); what remains is
writing the migration, which needs Vaughn's groupmate because the database is
shared:

| Feature | Blocked by |
|---|---|
| **Partial return counts** ("47 of 50 chairs") | `booking_equipment.returned` is a **boolean**. There is no quantity column |
| **Missing / damaged per event** | `equipment.damaged_quantity` is a stock total with no event attached — nothing can be traced back |

Until those are resolved the Return Checklist is all-or-nothing per item. **Do
not work around this** by packing counts into `booking_equipment.notes` or by
overloading `equipment.damaged_quantity` — both corrupt columns the web app
depends on.

> **Corrected 1 Sep 2026.** A third row here read *"The OM logging in as
> themselves — there is no staff table and no role column. `manager` holds one
> row."* That was false. `staff_account` exists and `is_main_cook()` is live in
> production RLS. Authentication is not blocked and never gated the other two.
> See §2.1.

---

## 6. Staying in sync

The web pages already subscribe to Postgres changes:

```
equipment-page  →  equipment, booking_equipment, package_equipment, booking
vehicles-page   →  vehicle, vehicle_assign, booking
```

So **a return recorded on the phone appears on the manager's screen without a
refresh.** The OM app should subscribe to the same tables for the reverse
direction — a manager reassigning a van mid-morning must reach the driver.

Debounce the refresh. Both apps writing several rows for one event will fire a
burst of change events.

---

## 7. Landmines

Ordered by how easy each is to hit.

1. **Two rows per booking per vehicle.** §3.1. Every count, every `.single()`,
   every job list. This is the one that will bite first.
2. **`quantity_available` is not the total.** §3.4.
3. **The 1000-row cap.** Silent truncation, no error, gets worse on its own.
4. **`PICKUP_GRACE_HOURS` means two things at once.** §3.2. Change it in one
   app only and the checklist and the trip disagree.
5. **Display labels vs stored values.** §2. Writing `'Returned'` into
   `assignment_status` would break every web query that filters on it.
6. **Timezones.** Never feed `.toISOString()` into a local datetime control —
   it shifts by the UTC offset, and the shift is cumulative: save twice and a
   morning event crosses onto the previous day. The web app had this in four
   edit forms; **fixed 1 Sep 2026** (audit D3) and the conversion now lives in
   `utils/datetimeLocal.js`. Port that, do not re-derive it. The same class of
   bug hit `vehicle_assign.dispatch_datetime`, which is `timestamptz` — a
   zoneless string sent to it is read as UTC and lands eight hours out.
7. **`booking_equipment`'s primary key is `assignment_id`** — the same column
   name `vehicle_assign` uses, on a different table. Easy to cross-wire.
8. **A cancelled booking's rows are deleted outright**, not archived. If the app
   is holding a packing list when the manager cancels, it must refetch, not
   assume. Completed rows now survive — cancelling releases what is still held
   and keeps what already happened — so a returned item stays in history.

9. **The `anon` RLS policies are wider than they look.** `booking`, `customer`
   and `payment` each carry a policy granting `anon` access with
   `USING (true)`, and one on `booking` is an **`UPDATE`** — so any booking's
   `total_amount` is currently writable by anyone holding the public key. These
   predate the OM app and Vaughn is addressing them with his groupmate. **Do
   not model new policies on them**, and do not assume the database is
   protecting you today. §2.1.

   This is also why the usual reassurance about the Supabase anon key does not
   apply here. The key ships in every client bundle, which is normal *because*
   RLS is meant to stand behind it. With these policies in place it does not,
   so the key grants what they grant. `docs/HANDOFF.md`, under **Things that
   will bite you**, states the same thing from the web app's side.

10. **`kitchen_task_status.booking_id` is `text`, not `uuid`.** `booking.booking_id`
    is a uuid, so there is **no real foreign key**: kitchen rows can point at
    bookings that do not exist, and deleting a booking silently orphans them.
    The table is near-empty, so this is cheap to fix now and a
    migration-with-backfill later. If the OM app ever joins to it, do not
    assume referential integrity.

11. **A realtime subscription to an unpublished table succeeds and delivers
    nothing.** Supabase reports `SUBSCRIBED` and then stays silent — no error,
    no warning, forever. If `booking_equipment` is not in the
    `supabase_realtime` publication, the OM will tick items off a return
    checklist and the manager's screen will keep showing them as out until
    someone reloads. Check before trusting §6:

    ```sql
    select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' order by tablename;
    ```

    Row-filtered subscriptions additionally need `REPLICA IDENTITY FULL`,
    because DELETE events match the filter against the OLD row.

---

## 8. What is still open

- ~~**The three writes in §5.3**~~ **SETTLED 2 Sep 2026** — Vaughn approved
  adding `return_log` and `booking_equipment.returned_quantity`. Partial returns
  and missing/damaged become buildable once the migration lands; until then
  build the checklist all-or-nothing, not around the gap.
- **`is_operations_manager()` and its policies** — the *mechanism* exists
  (§2.1); what is missing is the role predicate mirroring `is_main_cook()` and
  the policies scoping it to §1.3. This is a database change on a shared
  project, so it needs Vaughn and his groupmate, but it does **not** block the
  app the way this bullet previously claimed: it read *"Blocks the app before
  any screen renders"*, which was wrong.
- **Dispatch status (UFR-OM-04 / SFR-OS-04)** — "update and log delivery and
  dispatch status". Beyond `assignment_status`'s two values there is nowhere to
  record en-route / arrived / departed. Either scope it to the two values that
  exist, or it joins the §5.3 list.
- **The fleet is five vehicles, not three.** the capstone's §1.1 says three
  cars and two motorcycles. `FLEET_SIZING` on the web is calibrated for three.
  Settle this before the OM app starts reporting shortfalls that aren't real.
