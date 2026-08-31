# Blueprint 05 — Syncing equipment with the Operations Manager

Extends [`blueprint-04-mobile-sync.md`](blueprint-04-mobile-sync.md), which
covers both staff apps in general. This one is narrower and deeper: **how
equipment stays correct when a second person can change it.**

Written 30 Aug 2026, against the code as pushed in `f6af187`. Everything below
was checked against the source or the live database; where something is assumed
rather than verified, it says so.

---

## 1. Two things changed since blueprint-04 was written

Blueprint-04 §5 says the Main Cook and Operations Manager "cannot log in" —
that there is no staff table and no role column, and that this blocks both apps
entirely.

**That is no longer true.** The live database now has:

| Object | What it is |
|---|---|
| `staff_account` | PK `user_id` → `auth.users`. Columns: `display_name` (default `'Main Cook'`), `role` (default `'main_cook'`), `active`, `created_at`, `updated_at` |
| `kitchen_task_status` | PK `booking_id`, plus `done`, `done_at`, `done_by` → `auth.users` |
| `is_main_cook()` | A Postgres function, **already used in live RLS policies** on `booking` and `customer` |

So a staff member *can* authenticate, and a role-scoped RLS pattern is already
running in production. The Operations Manager does not need a new mechanism
invented for it — it needs the existing one extended.

**One defect to fix before building on it:** `kitchen_task_status.booking_id` is
declared `text`, while `booking.booking_id` is `uuid`. There is therefore **no
real foreign key** — kitchen rows can point at bookings that do not exist, and
deleting a booking silently orphans them. The table is near-empty today, so
this is a trivial fix now and a migration-with-backfill later.

---

## 2. What the Operations Manager does with equipment

From the documentation (Fig 4.2.4.33–4.2.4.39), the equipment-touching parts:

| Screen | Reads | Writes |
|---|---|---|
| **Packing list** | `booking_equipment` for the event, joined to `equipment` for names, grouped by `equipment_type` | — |
| **Itinerary** | `vehicle_assign` + `vehicle` for the date | — |
| **Return checklist** | the same packing list | `booking_equipment.returned`, `returned_at` |
| **Completed summary** | every `booking_equipment.returned` true | — |

Three of the four are **reads against tables that already exist**. The packing
list in particular needs no new table at all — it is the piece of paper the
business currently does not have, and the data for it has been there all along.

The one write is the return checklist, and it is where all the difficulty is.

---

## 3. The rules the web app enforces — which the ops app must not bypass

These are not conventions. They are enforced in the admin's code today, and an
ops app that ignores them will produce states the admin cannot display or
reconcile.

**Equipment is allocated at approval, not before.**
`Pending → Approved` runs `allocateEquipmentForBooking`, which writes
`booking_equipment` rows from the package template. Before that moment a
booking has no equipment rows at all. An ops app must not create them.

**Equipment may only be changed while a booking is `Approved`.**

```js
canAssignEquipmentTo(status) =
  ACTIVE_BOOKING_STATUSES.includes(status) && !isPaymentLedgerLocked(status)
```

`Confirmed` locks the booking; `Completed`, `Cancelled` and `Rejected` are
settled history. Derive this — never hardcode `'Approved'`.

**Returns open when the collection run sets off, and are due at 24 hours.**

> Equipment is due back within 24 hours of the event start. Returns can be
> recorded from **4 hours** after the event starts — when the collection run
> sets off — and anything still out past the 24-hour mark is flagged Overdue.

The 4 comes from `PICKUP_GRACE_HOURS` in `utils/vehicle.js`, and **must be
imported, not restated.** It was hand-copied into two other files and both
copies had already drifted by an hour before this was noticed.

**Stock is four numbers, not one.** `getStockBreakdown` in
`utils/equipment.jsx` owns this:

```
total          = quantity_available + damaged_quantity + maintenance_quantity
usable         = quantity_available          (NOT the total)
outOfService   = damaged + maintenance
free           = usable − committed          (may be negative — "Short by N")
```

`quantity_available` is **usable stock, not total stock**. Reading it as a total
is the exact mistake PR-26 was raised for. `free` is deliberately allowed to go
negative, because "more promised than we own" is the case a manager must act on.

**Shortage is a per-day, cross-event question.** Several events share one pool.
A per-booking shortage metric reads zero forever, because approval allocated the
whole template.

**Short Orders have no equipment.** Excluding them is correct, not an oversight.

---

## 4. What "sync" actually means here

There is no sync service and no polling loop to build. Both apps talk to the
same Postgres tables, so they are already sharing state. What has to work is
**each app learning that the other changed something.**

The admin already subscribes:

```js
// src/pages/Equipment.jsx
useRealtimeRefresh('equipment-page',
  ['equipment', 'booking_equipment', 'package_equipment', 'booking'], fetchData);
```

**The prerequisite that will bite you.** A Supabase realtime subscription to a
table that is *not in the `supabase_realtime` publication* reports
`SUBSCRIBED` and then delivers **nothing, forever** — no error, no warning. If
`booking_equipment` is not published, the Operations Manager will tick items
off a return checklist and the admin's Equipment page will sit there showing
them as still out until someone reloads.

Check before building anything else:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by tablename;
```

Row-filtered subscriptions additionally need `REPLICA IDENTITY FULL`, because
DELETE events match the filter against the OLD row.

---

## 5. One writer became two — what that breaks

Every concurrency guard in the admin is **client-side**, written when a single
manager was the only person who could change anything. A second writer changes
the assumptions, not just the load.

**The pattern already found and fixed for vehicles, which equipment shares.**
`vehicle_assign` has no uniqueness constraint, so two people assigning the same
van both passed the client check and both inserted. The mitigations were
(a) re-checking conflicts against fresh rows immediately before the insert, and
(b) a unique index catching exact duplicates. Equipment has the same shape:
`booking_equipment` has no constraint preventing the same equipment being
allocated twice to one booking, and stock maths is computed from a list the
client fetched at page load.

**The concrete hazard.** Manager and Operations Manager both look at 50 chairs
with 10 free. Both allocate 8 to different events. Both clients validated
against 10. The database accepts both, and `free` is now −6 — a shortage nobody
was warned about, discovered on the day.

**What to do about it, in order of cost:**

1. **Re-check before write.** Re-read the committed quantity immediately before
   inserting and refuse if it no longer fits. Non-atomic, but it shrinks the
   window from "however long the page has been open" to one round trip. This is
   what `recheckConflictsBeforeInsert` does for vehicles and it is the cheapest
   real improvement.
2. **Split the writes by role.** If the Operations Manager owns *returns* and
   the manager owns *allocation*, the two never write the same field and the
   race mostly evaporates. This is architectural, costs nothing, and is the
   approach that worked for dispatch.
3. **A database constraint.** Correct and atomic, but stock is a computed
   aggregate rather than a column, so enforcing it means either a trigger or a
   materialised committed-quantity — a schema change on a shared database.

Recommendation: **(2) then (1).** Do not reach for (3) first.

---

## 6. What can be built with no schema change, and what cannot

**Works today, read-only:** packing list, itinerary, food list, completed
summary. All four are queries against existing tables.

**Works today, write:** marking a whole item returned —
`booking_equipment.returned = true`, `returned_at = now()`. This is exactly what
the admin's Return button does, so the two stay consistent by construction.

**Cannot be built without a schema change** (unchanged from blueprint-04 §3.3):

| Feature | Blocked by |
|---|---|
| Partial return counts ("47 of 50 chairs") | `booking_equipment.returned` is a **boolean**. A count has nowhere to go |
| Missing / damaged per event | `equipment.damaged_quantity` is a stock total with no event attached, so nothing can be traced or charged back |

Do not work around these by packing state into `booking.notes` or overloading
`booking_status`. Both are columns the web app depends on, and corrupting them
is worse than the schema change. Blueprint-04 §7.1 proposes the additive fix —
`return_log`, plus `booking_equipment.returned_quantity` beside the existing
boolean — which breaks no existing line of the web app.

---

## 7. RLS for the new role

Follow `is_main_cook()` exactly — it is already live and proven.

```sql
-- shape, not final; write it with the groupmate present
create or replace function is_operations_manager() returns boolean as $$
  select exists (
    select 1 from staff_account
    where user_id = auth.uid()
      and role = 'operations_manager'
      and active
  );
$$ language sql stable security definer;
```

Then policies scoped to what the role actually does — read the packing list,
update `returned` — and **nothing more**. Specifically it should not be able to
delete `booking_equipment` rows, change `equipment` stock totals, or touch
`booking_status`.

**Two cautions.**

The existing policies on `booking`, `customer` and `payment` include several
granting `anon` access with `USING (true)`, including one **`UPDATE` on
`booking` with `USING (true)`** that permits rewriting any booking's
`total_amount`. Those predate this work and are being addressed separately with
the groupmate. Do not model new policies on them.

And a new policy is a change to a database three apps share. Additive policies
for a new role are low-risk; anything that narrows an existing one is not.

---

## 8. Build order

1. **Fix `kitchen_task_status.booking_id`** to `uuid` with a real FK, while the
   table is still nearly empty.
2. **Verify the realtime publication** covers `booking_equipment` and
   `equipment`. Without this, nothing below appears to sync at all.
3. **`is_operations_manager()` + `staff_account` rows**, mirroring the main-cook
   pattern.
4. **Read-only screens first** — packing list, itinerary. They need no writes,
   no schema change, and they prove the auth and realtime plumbing before any
   data is at stake.
5. **Whole-item returns**, using the admin's existing rule (opens at
   `PICKUP_GRACE_HOURS`, due at 24 h, imported not restated).
6. **Then** decide on `return_log` and `returned_quantity` for partial returns,
   with the groupmate, as one additive migration.

Steps 1–5 need no schema change beyond the type fix in step 1.

---

## 9. What this document does not claim

The Operations Manager app does not exist yet, so none of this has been
exercised. The rules in §3 are read from the admin's source and are accurate as
of `f6af187`; the concurrency hazards in §5 are reasoned from the same defects
already found and fixed on the vehicle side, **not** observed on equipment. The
realtime prerequisite in §4 has not been checked — the query is there because
nobody has run it.
