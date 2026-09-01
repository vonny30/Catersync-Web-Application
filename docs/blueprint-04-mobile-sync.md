# Blueprint 04 — Syncing the Main Cook and Operations Manager apps

How the two staff mobile apps in the documentation connect to the database the
web app actually has. Written 29 Aug 2026 against `CaterSync Main.pdf` (the
capstone documentation) and the admin web tree as it stands today.

**This is a plan. Nothing here is built.** §7 holds the one decision that
blocks roughly half of it, and it is a decision only Vaughn can make.

Read with `mobile-contract.md`, which states the rules any client must honour.
This document is about what these two apps specifically need, and what is
missing.

---

## 1. What the documentation specifies

From §1.2 of the capstone, the two staff apps exist to do this:

> "To provide Main Cook with a Mobile Application to track and view the daily
> food preparation list."
>
> "To provide the Operations Manager with a Mobile Application to track vehicles
> assigned, monitor equipment checklists, and log items returned."

And from §1.1, what they replace: the main cook's totals are currently computed
by the manager **on a whiteboard**, and the operations manager has **no packing
list at all**, "and thus equipment is left or not taken to out-of-town venues."

That is the whole point of these two apps, and it is worth keeping in view:
they are not dashboards. Each one replaces a specific piece of paper.

### Main Cook — Fig 4.2.4.28 to 4.2.4.32

| Screen | Shows | Writes |
|---|---|---|
| Profile | account, contact, change password, sign out | contact, password |
| Today's Kitchen Tasks — **By Event** | each event's dishes with pax sizes, add-ons, special requests, target time, status | **Mark as Done / Undo** |
| Today's Kitchen Tasks — **Aggregated** | total pax per dish across all of today's events, estimated trays, and a per-event breakdown | — |
| Calendar filter | the same, for any chosen date | — |

### Operations Manager — Fig 4.2.4.33 to 4.2.4.39

| Screen | Shows | Writes |
|---|---|---|
| Profile | account, contact, change password, sign out | contact, password |
| Today's Operation Tasks | **"Today's Itinerary: 3 Trips"** — each event's venue, time, type, status | — |
| Event Equipment / Item Checklist / Food List | the packing list, grouped, plus the food going with it | — |
| Return Checklist | every assigned item with a **returned count** per item | **Submit Return Log**, missing/damaged |
| Completed Event Return Summary | confirmation that everything came back | — |
| Calendar filter | the same, for any chosen date | — |

**"Today's Itinerary: 3 Trips."** The documentation already counts an operations
manager's day in **trips**, not in bookings — which is exactly the model
`utils/vehicle.js` was rebuilt around this week. That is a real alignment, not a
coincidence: three events with a van each is three trips, and one van doing two
of them is still three trips. §4.1 makes it literal.

---

## 2. The uncomfortable part: the documentation and the database disagree

The DFDs name data stores that **do not exist** — not in the logical model
(Table 4.2.3.3.1), not in the conceptual ERD, and not in the live database:

| Data store | Named in | Exists? |
|---|---|---|
| `KITCHEN_TASK` (DS10) | Fig 4.2.2.7, Process 5.0 | **No** |
| `RETURN_LOG` (DS12) | Fig 4.2.2.8, Process 6.0 | **No** |
| `EQUIPMENT_LOG` / `OPERATIONS_LOG` (DS11) | Fig 4.2.2.8, Fig 4.2.2.9 | **No** |
| `RESOURCE_ASSIGNMENT` (DS9) | Fig 4.2.2.8 | **No** — the real table is `vehicle_assign` |
| `INVENTORY_ITEM` (DS7) | Fig 4.2.2.8 | **No** — the real table is `equipment` |
| `BOOKING_ITEM` (DS5) | Fig 4.2.2.7 | **No** — the real table is `menu_selections` |

Some of these are only naming drift, and harmless once translated. Three are
not: **`KITCHEN_TASK`, `RETURN_LOG` and `OPERATIONS_LOG` are where the two apps'
only writes were supposed to go.** Without them, "Mark as Done" and "Submit
Return Log" have nowhere to land.

Two more mismatches worth naming now, both in figure captions:

- Fig 4.2.4.36 sources the packing list from **`BOOKING_VEHICLE`**. The real
  table is `vehicle_assign`.
- Fig 4.2.4.37 says the return checklist "is recorded and updated in the
  **EQUIPMENT** table." Recording a *per-event* return in the *stock* table
  would lose which event it came back from. Returns belong on
  `booking_equipment`, which the web already uses; only damage counts belong on
  `equipment`.

The built system has also moved well past the documented logical model —
`booking_equipment`, `menu_selections`, short orders, `status_order`,
`booking_number`, `damaged_quantity`, `maintenance_quantity` and the rest are
all real and none are in Table 4.2.3.3.1. **The documentation will need a
revision pass regardless of what the apps do.** That is a separate job from
this one, but the panel will ask.

---

## 3. What can be built today, with no schema change

Most of both apps. Every read is already available.

### 3.1 Main Cook — the whole cooking list

Everything the two views need is derivable from tables that exist:

```
booking            event_datetime, venue, pax_count, booking_status,
                   booking_type, notes  (the "special request" text)
menu_selections    {menu_item_id, quantity} per booking
menu_item          menu_name, menu_category
package_menu       the package's default dishes
```

- **By Event** — filter `booking` to the chosen date with
  `booking_status IN ('Approved','Confirmed')`, join its `menu_selections`,
  group by booking. Target time is `event_datetime`.
- **Aggregated** — the same rows, grouped by `menu_item_id` instead, summing
  quantity, with the per-event breakdown kept for the drill-down the mockup
  shows.
- **Estimated trays** — `menu_selections.quantity` is already a tray count, so
  the "Est. Containers Needed" figure is a sum, not an estimate. Say "trays",
  not "estimated".
- **Calendar filter** — same query, different date.

One warning carried over from Blueprint 02 §4: **`menu_selections` stores no
price snapshot.** Tray counts are exact; any peso figure is derived. A kitchen
app should show trays and pax and never money.

### 3.2 Operations Manager — itinerary, packing list, food list

Also fully available:

```
vehicle_assign     dispatch_datetime, assignment_status, vehicle_id, booking_id
vehicle            plate_number, vehicle_type, vehicle_status
booking_equipment  equipment_id, quantity, returned, returned_at
equipment          eqm_name, equipment_type, quantity_available,
                   damaged_quantity, maintenance_quantity
```

- **Itinerary** — the vehicle's trips for the date, from
  `getDailyVehicleSnapshot`. §4.1.
- **Packing list** — `booking_equipment` for the event, joined to `equipment`
  for names, grouped by `equipment_type`. This is the piece of paper that does
  not currently exist, and it needs no new table at all.
- **Food list** — the same `menu_selections` read the Main Cook app uses.
- **Completed summary** — every `booking_equipment.returned` true.

### 3.3 What genuinely cannot be built without a schema change

Exactly three things, all writes:

| Feature | Needs | Why nothing existing fits |
|---|---|---|
| Main Cook **Mark as Done / Undo** | a per-booking, per-dish cooking status | No column anywhere holds it. `booking_status` is the *event's* lifecycle and must not be borrowed |
| Return Checklist **partial counts** | a returned **quantity** per item | `booking_equipment.returned` is a **boolean**. "47 of 50 chairs came back" cannot be written |
| **Missing / damaged** per event | which event lost the item | `equipment.damaged_quantity` is a stock total with no event attached, so nothing can be traced or charged back |

Everything else on both apps is a read against tables that already exist.

---

## 4. Aligning with what was just built

### 4.1 The itinerary is trips, and trips now have legs

`utils/vehicle.js` was rebuilt on 28–29 Aug around one idea: a dispatch occupies
a vehicle for a **trip window**, not for a day. A booking now produces up to two
`vehicle_assign` rows on one vehicle:

```
dispatch_datetime <  event_datetime   →  Setup run
dispatch_datetime >= event_datetime   →  Pickup run
```

For the Ops Manager app this is a gift, not an obstacle — it is exactly the
itinerary the mockup asks for. Ordered by dispatch time, a day reads as:

```
06:00  Setup   Karl Wedding @ Grand Hall     ABC-123
08:45  Setup   Jude Birthday @ City Hall     ABC-123
12:00  Pickup  Karl Wedding @ Grand Hall     ABC-123
```

But the app **must** derive the leg the same way, or "Today's Itinerary: 3
Trips" will count three rows for what a driver knows is two journeys and a
collection. Do not group by booking; group by trip and label the leg.

The **Return Checklist belongs to the collection run**, not to the event. It
should open when the collection trip starts, which is also when the web's
Return button unlocks — 4 hours after the event begins (PG's collects 4-7 hours
afterwards; the model takes the early end). Both come from
`PICKUP_GRACE_HOURS`, and they must stay equal: the web page now imports that
constant rather than restating the number, because the two had already drifted
apart once.

Note the leg names changed: `TRIP_LEG` is now `Setup run` / `Collection run`.
"Pickup" was ambiguous against a short-order *customer pickup*, which is the
opposite direction of travel.

### 4.2 Reading resources correctly

- **Equipment stock**: `total = quantity_available + damaged_quantity +
  maintenance_quantity`. `quantity_available` alone is **usable**, not the total.
  This was a real bug on the web page; do not repeat it.
- **Vehicle availability**: a window test, never a same-day comparison.
- **`assignment_status`** stores `Scheduled` / `Completed`; it is displayed as
  Assigned → In Use → Returned. Never display the stored value.
- **Every list must page** — the 1000-row cap returns truncated data with no
  error, and `vehicle_assign` now grows two rows per booking per vehicle.

### 4.3 Where the status words must agree

The Ops mockup shows event status as **On Going** and **Completed**. There is no
such column. `booking_status` holds `Confirmed` before the event and `Completed`
after, and nothing marks "happening right now". Either derive it —
`Confirmed` + event started = On Going — or drop the word. Deriving is correct
and free; inventing a stored value is not.

### 4.4 An open question the documentation raises

§1.1 says PG's has "**three cars and two motorcycles** available for dispatch" —
five vehicles. Vaughn said three. `FLEET_SIZING` in `utils/vehicle.js` is
calibrated against three. Whichever is right, the constant should match reality
before the ops app starts reporting shortfalls that are not real.

---

## 5. ~~The gap nobody has mentioned yet: these two people cannot log in~~ — RESOLVED

> **WRONG AS WRITTEN. Corrected 1 Sep 2026.** This section said staff cannot
> log in, and §7's decision is framed around that. Verified against the live
> database: `staff_account` exists (PK `user_id` → `auth.users`, with `role`
> and `active`), `kitchen_task_status` exists, and **`is_main_cook()` is
> already used in production RLS policies** on `booking` and `customer`. A
> staff member can authenticate today and a role-scoped pattern is running.
>
> What is actually needed for the Operations Manager is an
> `is_operations_manager()` mirroring it, plus policies — see
> [`ops-manager-sync.md`](ops-manager-sync.md) §2.1. That is a database change
> needing Vaughn and his groupmate, but it does not block either app.
>
> **This also changes §7.** Its recommended migration proposes creating
> `staff_account` — a table that already exists. Read §7.1 as three items, not
> four: `kitchen_task` (see the note there), `return_log`, and
> `booking_equipment.returned_quantity`. The paragraphs below are kept as the
> record of what was believed on 29 Aug, not as instructions.

The logical model has exactly two account tables — `CUSTOMER` and `MANAGER` —
and `MANAGER` holds one row. There is **no staff table and no role column**, so
there is currently no way for a Main Cook or an Operations Manager to
authenticate as themselves.

Both apps open on a profile screen with an email (`kitchen1@pgs.com`,
`opsmgr@pgs.com`), a contact number, and Change Password. That is an account.
Nothing in the database can hold one.

This blocks *both* apps entirely — before any screen, before any query — and it
is not in §3.3 because it is bigger than a missing column. It needs a decision
alongside §7.

---

## 6. Build order

Assuming §7 goes the way §7.1 recommends.

**Phase A — accounts.** Whatever §5 resolves to. Nothing else can start.

**Phase B — Main Cook, read-only.** By Event, Aggregated, calendar filter. This
is the whiteboard replacement and it needs no schema change at all. Ship it
before the write features and it is already useful on day one.

**Phase C — Operations Manager, read-only.** Itinerary from trip windows,
packing list, food list. This is the out-of-town-equipment problem from §1.1,
and it also needs no schema change.

**Phase D — the three writes.** Cooking status, partial returns, missing and
damaged. Only after §7.

**Phase E — documentation revision.** Reconcile Table 4.2.3.3.1 and the DFDs
with what was actually built (§2). Needed for the panel regardless.

Phases B and C are the ones that deliver the objectives in §1.2 verbatim. They
are also the ones with no blockers.

---

## 7. The decision

**Does the "no schema changes" rule still hold?**

It has been the standing constraint on every piece of work so far, and every
blueprint has respected it — Blueprint 03 went to real lengths to avoid a
column, deriving the setup/pickup leg from a timestamp comparison rather than
storing it.

But §3.3 and §5 cannot be derived. A cooking status is a fact about the world
that nothing else records. A partial return count is a number with nowhere to
go. A staff login is a row that does not exist. No amount of cleverness produces
them from the current tables, and any workaround — packing state into
`booking.notes`, overloading `booking_status` — would be worse than the schema
change, because it would corrupt a column the web app depends on.

**7.1 · Recommended: a small, additive change — three tables and one column.**

```
staff_account      ALREADY EXISTS — do not create. Live as:
                   user_id (PK, FK -> auth.users), display_name,
                   role (default 'main_cook'), active, created_at, updated_at
kitchen_task       PARTLY EXISTS as `kitchen_task_status`
                   (booking_id PK, done, done_at, done_by). Per-BOOKING, not
                   per-dish, so a per-dish status still needs somewhere to go.
                   NOTE its booking_id is `text` where booking.booking_id is
                   `uuid` — no real FK. Fix that before building on it.
return_log         log_id, booking_id, equipment_id, returned_quantity,
                   missing_quantity, damaged_quantity, logged_by, logged_at
booking_equipment  + returned_quantity   (keep `returned` as it is)
```

> **Corrected 1 Sep 2026.** The first two entries were written as proposals.
> Both are already in the database. Only `return_log` and the
> `returned_quantity` column remain to be added.

Additive only — nothing existing is renamed, retyped or dropped, so **not one
line of the web app breaks**. `booking_equipment.returned` keeps working exactly
as it does today; `returned_quantity` sits beside it for partial returns.

This is also what the documentation already specifies. `KITCHEN_TASK` and
`RETURN_LOG` are named in Fig 4.2.2.7 and 4.2.2.8 as data stores the system is
supposed to have. Adding them makes the database match the DFDs the panel
already approved, rather than diverging from them further.

**7.2 · The alternative: keep the rule, ship Phases B and C only.**

Both apps become read-only. The Main Cook still gets the cooking list that
replaces the whiteboard; the Ops Manager still gets the packing list that stops
equipment being left behind. Neither can record anything, so "Mark as Done",
"Submit Return Log" and missing-item reporting are cut, and §1.2's phrase "log
items returned" goes unmet.

That is a defensible scope cut, and it delivers the two biggest problems from
§1.1. It is worth saying plainly to the panel rather than leaving the buttons on
screen doing nothing.

**Either way, Phases B and C are unblocked once §5 is answered — and §5 needs an
account row no matter which path is chosen.**

---

## 8. What this plan is not

- It has **not** been checked against either mobile codebase. Nobody writing
  this has seen them. Everything above is derived from the capstone
  documentation and the web app's live schema usage.
- It assumes both apps read the same Supabase project directly. If they go
  through an API layer instead, the table-level rules still hold but the sync
  points move.
- Push notifications, offline behaviour, and what either app should do with no
  signal at an out-of-town venue are not covered here. For an app whose whole
  job happens at a venue, offline is worth a plan of its own.
