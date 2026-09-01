# Finishing the web application

One list, in order. Written 1 Sep 2026, after checking every open item against
the live tree rather than against older notes.

---

## The short version

**You are closer than it feels.** The reason it feels endless is that five
documents each hold a fragment of "what's left", and none of them holds the
whole thing. Here it is in one place.

The panel's list — the thing you are actually graded against — is **effectively
closed on the web side.** Of 32 items: one needs investigating, three need a
decision from you (not code), and four belong to the mobile app.

What genuinely remains for the web app is **five code fixes and one afternoon of
document editing.** That is the whole finish line.

| | Items | Nature |
|---|---|---|
| Must fix in code | **5** | Wrong numbers and corrupted data |
| Must fix in the document | **2 sections** | Typing, no code |
| Your decision needed | **4** | Answer them and they mostly vanish |
| Deliberately cut | everything else | See §5 |

---

## 1. What "finished" means here

Not "every improvement built". For a capstone defence, finished means:

1. **No screen shows a wrong number.** A panelist who adds up what's in front of
   them gets the same answer the system does.
2. **Nothing corrupts data behind their back.**
3. **The system and its documentation describe each other.** This is where marks
   are actually lost, and it is the cheapest thing to fix.
4. **Every panel comment is closed, or closed with a stated reason.**

Anything that isn't one of those four is not a finishing task. That single test
removes about two thirds of what is currently on your plate.

---

## 2. The five code fixes — all verified still open today

In order. Do them in this order; each is independent, so you can stop anywhere
and what you've done still holds.

### Fix 1 · Extra guests are priced at the full package price
`hooks/useApprovalHandlers.js:116-117` — **~15 minutes**

```js
const pkgPrice = approvalBooking?.package?.pkg_price || 0;
const extraPaxCost = (updated.extraPax || 0) * pkgPrice;   // ← no pricing_type branch
```

`computeBaseTotal` in the same file already branches correctly at `:60`. This
one doesn't. On a ₱25,000 fixed package with `extra_pax_price` ₱400, adding 5
guests at approval writes **₱150,000** instead of ₱27,000.

**Fix:** branch on `pkg.pricing_type` exactly as `computeBaseTotal` does — use
`extra_pax_price` for fixed, `pkg_price` for `per_pax`. Fix the hint text under
the input at the same time; it currently states the wrong rule out loud.

**Done when:** a fixed package priced at ₱X with 5 extra guests shows
`baseTotal + 5 × extra_pax_price`, and a per-pax package is unchanged.

### Fix 2 · "Mark as Completed" promotes unverified payments
`pages/Bookings.jsx:1065`, `pages/ShortOrders.jsx:1012` — **~20 minutes**

Both still run `.update({pay_status:'Fully Paid'}).eq('booking_id', id)` with no
other filter. `useCompletionHandlers.js:82-85` has the correct narrowed version
and a comment explaining why. A rejected proof becomes collected revenue.

**Fix:** delete both private handlers and call the shared hook. Don't patch the
filters in place — that leaves three copies of one rule and this is the third
time it has drifted.

**Done when:** completing from the list and from the detail page do the same
thing, and a `Pending Verification` row is untouched by either.

### Fix 3 · Editing a booking shifts the event by 8 hours
`Bookings.jsx:594`, `BookingDetails.jsx:604`, `ShortOrders.jsx:582`,
`ShortOrderDetails.jsx:552` — **~20 minutes, same fix four times**

All four load `new Date(x).toISOString().slice(0,16)` — a UTC clock — into a
`datetime-local` input, which means local. Open an 18:00 event to fix a typo and
it shows 10:00; save and it moves.

**Fix:** offset before slicing, the way `Dashboard.jsx:20-25` already documents:

```js
const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
return local.toISOString().slice(0, 16);
```

Put it in one helper and use it in all four.

**Done when:** open an event's edit form, save without touching anything, and
`event_datetime` is byte-identical.

### Fix 4 · A failed stock check is treated as a passed one
`pages/Equipment.jsx:694-696` and `:782-784` — **~10 minutes**

```js
} catch (checkError) {
  console.warn('Committed-quantity check failed:', checkError);
}   // ← falls straight through to the write
```

**Fix:** `toast.error` and `return`, matching the assign path at `:1045-1050`.
A guard that can't run must block, not wave through.

### Fix 5 · Two report figures don't reconcile
`Payments.jsx:1130` and `Reports/index.jsx:393` — **~20 minutes**

- Payments' Total Collections is computed after refunds are filtered out, then
  captioned "Already subtracts any refunds." Either compute it from unfiltered
  rows, or change the caption to say gross. Also hide the card on the Refunds
  tab, where it renders as a negative number under that same caption.
- `Reports/index.jsx:393` returns before line 396 adds the delivery fee, so a
  short order with no menu selections is missing from the footer's
  reconciliation while its revenue is in the total above it. Move the
  `deliveryFeeTotal +=` above the early return.

**Done when:** Menu items + Delivery fees equals Short order revenue, and the
Payments card agrees with the Dashboard for the same period.

---

## 3. The document work — an afternoon, no code

**This is where the marks are.** The system is ahead of its documentation, and
right now the document is what the panel reads.

### Doc 1 · Table 4.2.3.3.1, the logical database model
The single biggest gap. Roughly 30 items wrong in both directions — tables in
use but undocumented (`booking_equipment`, `category`, `package_category`),
columns in use but undocumented (`booking_number`, `booking_type`,
`total_amount`, `status_order`, `menu_selections`, `damaged_quantity`,
`maintenance_quantity`, and more), and documented columns nothing uses
(`pay_installment`, `PAYMENT.package_id`, `VEHICLE_ASSIGN.manager_id`).

§3 of `audit-2026-08-31.md` lists every one. It transcribes straight in.

**Do this one first.** A panelist comparing your ERD to a live query is the most
likely single question, and it is pure typing.

### Doc 2 · Four requirements that are met but described wrongly
Free marks currently being lost:

- **NFR-05, passwords.** Your schema table shows `managerpass!123` sitting in a
  column. Passwords are actually bcrypt-hashed in Supabase Auth and the app
  never reads a password column. Right now your own document gives the worst
  possible answer to a question your system answers well. Fix the table.
- **UFR-MA-02, the calendar.** A real month-grid calendar exists on the
  Dashboard — navigation, type-coded day dots, day-click drill-through. There is
  no `/calendar` route, so it reads as missing. Either reword to "a calendar
  view on the Dashboard" or add the route (§4).
- **UFR-MA-08, "add-on services".** No such entity exists — no table, no column,
  no UI. Drop the phrase or define it as booking-level adjustments.
- **SFR-CU-07, automatic delivery cost by location.** Not calculated; typed by
  hand. `FREE_DELIVERY_AREAS` is the nearest thing. Check what the customer app
  does before claiming it.

### Doc 3 · Two requirements the code deliberately contradicts
- **SFR-MA-05** says vehicles are blocked for the whole date. Your code allows
  same-day reuse, on purpose, because that is what PG's does — and the
  document's own §1.1 agrees with the code. Rewrite the requirement as a
  trip-window rule; `blueprint-03-dispatch.md` §4.2 has the wording.
- **NFR-05 / SFR-03 claim role-based access control.** There is none — one
  existence check against the `manager` table. Either say plainly that role
  separation is achieved by shipping separate applications, or build it (§5 says
  don't).

### Doc 4 · One line of code that closes an ethics commitment
§3.6 promises a record of "who has done what and when". Nothing records **who**.
Populating `vehicle_assign.manager_id` on insert is one line, fills a column your
own schema already documents, and lets you answer the question honestly. Cheapest
item in this document — do it while editing Doc 1.

---

## 4. Four decisions only you can make

Each is blocking something. None needs code first.

| # | Question | Why it matters |
|---|---|---|
| 1 | **PR-14** — which way should the password eye icon point? | One-line fix, blocked purely on your preference |
| 2 | **PR-16** — may a booking with a verified downpayment be deleted? | Money already taken. Currently allowed |
| 3 | **PR-32** — does a package sale count toward its component dishes in Menu Performance? | Changes what the report means |
| 4 | **The fleet: three vehicles or five?** | The capstone says three cars + two motorcycles. `FLEET_SIZING` assumes three. Wrong either way is a wrong shortfall warning |

The schema decision in `blueprint-04-mobile-sync.md` §7 blocks the **mobile**
apps, not the web app. It does not belong on this list.

---

## 5. What to cut, and say so out loud

Cutting is a decision you get credit for, not a failure — as long as it is
stated rather than discovered.

| Cut | Why |
|---|---|
| **Blueprint 03 Phases 3 and 4** — the Availability timeline, trip type in History, the Dispatch section on detail pages, the Reports utilization fix | Real improvements to a page that already works. None is a wrong number |
| **Blueprint 02 §9 step 6** — remaining wording items | The vocabulary is already consistent where it matters |
| **Blueprint 01 unstarted items** | The money model is fixed; the rest is reporting polish |
| **Building actual RBAC** | Days of work, and the four apps already separate concerns. Describe the real design instead |
| **The `/calendar` route** | Only if you'd rather reword than build. Both are fine — pick one and stop |

---

## 6. Suggested order

Roughly a day and a half, spread how you like.

**Session 1 — the money bugs (~1 hour).** Fixes 1 and 2. These are the two that
corrupt data, and Fix 1 is the largest wrong number in the system.

**Session 2 — the rest of the code (~1 hour).** Fixes 3, 4, 5, plus the
`manager_id` line from Doc 4.

**Session 3 — the document (~3 hours).** Doc 1, then Docs 2 and 3. Longest
single block, and the highest return.

**Session 4 — close out (~1 hour).** Answer the four decisions. Mark PR-27
investigated. Add a short "known limitations" note covering everything in §5, so
every cut is a stated scope decision rather than a gap someone finds.

**Then stop.** When §2 and §3 are done, the web application is finished by the
definition in §1. Anything further is polish on a system that already works, and
the remaining time is better spent on the mobile apps and the defence itself.

---

## 7. How you'll know you're done

Walk these five in a browser. If they all hold, ship it.

1. Approve a fixed-price package with extra guests → the total is
   `base + n × extra_pax_price`.
2. Complete a booking that has a Pending Verification payment → that payment is
   still Pending Verification afterwards.
3. Open any booking's edit form, save immediately without changing anything →
   the event time is unchanged.
4. On Reports, Menu items + Delivery fees equals Short order revenue; the
   Payments card agrees with the Dashboard for the same month.
5. Open your ERD next to a live `select *` on `booking` → they match.
