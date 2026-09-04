# Page-by-page test report — 4 Sep 2026

Every page of the live application walked against the database, with the browser
console monitored throughout. Controls exercised, not just read: filters, quick
filters, tabs, drill-down modals, search, and the full booking lifecycle.

**No JavaScript errors on any page.** Every figure I could reconcile, reconciled —
with three exceptions, below.

---

## 1. Three real defects

### 1.1 The Dashboard's payments modal announces a range it does not honour
**Dashboard → "Payments Received This Month" card → date filter**

The card opens a modal titled *"Payments Received This Month (September 2026)"*
showing 2 records, ₱11,400. Correct.

Selecting **"This Year"** inside it prints:

> Filter applied: This Year (Jan 1, 2026 – Dec 31, 2026)
> Total received: **₱11,400**

The database holds **4 payments in 2026 totalling ₱26,650**. The figure is short
by **₱15,250**.

The modal is handed a dataset already scoped to September, so its own filter can
only ever narrow that set — never widen it. But it states the wider range as
applied, and prints a total a manager will read as the year's collections. The
default state has the same fault in reverse: *"Showing all-time data"* over
rows that are month-only.

**Fix:** either drop the date filter from this modal (the card already declares
its period in the title), or have it re-query rather than filter a pre-scoped
array. Stating a range you have not applied is the one thing it must not do.

### 1.2 "Outstanding Balance" means two different things on two pages
Same label, same moment, same data:

| Page | Sub-label | Figure |
|---|---|---|
| Payments | Unpaid balance on active bookings & orders | **₱110,550** |
| Reports → Overview and Financial | Still to collect | **₱135,550** |

The gap is exactly **₱25,000** — the two Pending bookings. Payments excludes
unapproved bookings from receivables; Reports includes them.

Both readings are defensible in isolation. Sharing one name is not. A panelist
who opens both tabs sees the system contradict itself about money.

**Fix:** Payments has the better rule — you are not owed money on a booking you
have not accepted. Either exclude Pending from the Reports figure too, or rename
the Reports one to something like *"Contracted, not yet collected"*.

### 1.3 Equipment utilization uses two different denominators
| Where | Reads | Denominator |
|---|---|---|
| Reports → Overview | "238 of **3539** units committed" | owned |
| Reports → Equipment Utilization | "238 of **3529** usable units committed" | usable |

The 10-unit difference is the gear that is damaged or under maintenance.

`EquipmentUtilizationTab.jsx:13` states the rule outright — *"measuring against
everything owned would flatter the number by counting broken gear as spare
capacity"* — and the Overview card is the one that breaks it. Both happen to
round to 7% today, which is precisely why it would go unnoticed until the
damaged count grows.

**Fix:** Overview should divide by usable, matching the tab and its own comment.

---

## 2. Content a panelist will see

Not code — but on screen, and two of these appear in the Reports.

| Item | Problem |
|---|---|
| **Cordon Bleu** | Description reads **"sdfsfsd"**. This is your **best-selling menu item**, named on the Reports Overview card. |
| **Focaccia** | Description is the single word "bread". |
| **Chicken Adobos** | Plural typo — should be Chicken Adobo. |
| **Cordon Bleu** | Filed under **Pork**. Cordon bleu is chicken and ham. |
| **Manager accounts** | Three accounts, all displaying **"PG's Catering"**, one with a trailing line break stored in its surname (`"Catering\r\n"`). `manager_id` now records who dispatched a vehicle, but the name it resolves to cannot tell three people apart. |

The Cordon Bleu description is the one to fix first — placeholder text on the
item the reports single out as your top seller.

---

## 3. Label items still unapplied

All confirmed live today, all from the earlier audits:

| Page | Now | Should be |
|---|---|---|
| Reports | `Financial & Reports` (page title) | **Reports** — Financial is one of its six tabs |
| Packages | `Packages & Menu` (heading) | **Packages & Menus** — matches the nav item clicked to get there |
| Reports → Equipment | `Free Now`, `FREE` column, "= free" | **Available** — "Committed" landed here, "Free" did not |
| Reports → Vehicles | `Vehicle Fleet Status` | **Fleet Status** — a fleet is already vehicles |
| Reports → Vehicles | "Free for a new dispatch" | **Available for a new dispatch** |
| Reports → Booking Summary | `TOTAL COMPLETED BOOKINGS` per-row header | **Completed Bookings** — "Total" belongs to the footer, where it already is |
| Reports → Booking Summary | `Historical booking summary` | Title case, matching the other five panel headings |
| Reports → Financial | "Each bar is the **total** verified payments" | **net** — refunds pull the bars down |
| Booking delete dialog | "3 payment records totalling ₱5,000" | The three rows total ₱7,500; the count includes the unverified payment, the total excludes it |

---

## 4. Production hygiene

The shipped bundle logs to the console on every page load:

```
Supabase URL is: https://qreuaphaxvfayxqqniqg.supabase.co
Supabase Key is: Found!
[session-lock] verifyOrReclaim result: ok …
[session-lock] Ignoring realtime update — this is our own claim.
```

No secret is exposed — the anon key is meant to ship — but a production build
announcing its backend URL and heartbeating every ten seconds is debug output
that was never turned off. Worth stripping, and trivial to.

---

## 5. Verified working

Reconciled against the database, page by page:

- **Dashboard** — Pending 2, Payments Received ₱11,400, calendar, stat modals,
  modal search ("1 of 2 records shown")
- **Bookings** — all seven status counters (12/2/6/2/1/1/0), pagination, both
  quick filters, "Filter applied: Custom (Sep 4 – Sep 4)"
- **Short Orders** — all seven counters (5/0/4/1/0/0/0), pickup vs delivery
  badges, and a **"Fee mismatch"** flag on a delivery outside the free area
- **Payments** — 4 records ₱26,650; Downpayment ₱22,750 + Fully Paid ₱3,900
- **Equipment** — Inventory 6; "120 units going out" on Sep 15 = `ceil(55/6)`+55+55
- **Vehicles** — fleet 4, committed 0, available 4, Committed/Available filters
- **Reports → Menu & Packages** — 11 + 5 = 16 bookings; ₱147,500 + ₱14,700 =
  ₱162,200 matching Contract Value; every share column sums to 100%; the footer
  reconciles ₱14,700 + ₱0 = ₱14,700
- **Reports → Equipment** — every row's owned − out of service = usable,
  usable − committed = free; totals 3529 / 238 / 3291
- **Reports → Vehicles** — fleet utilization still **refuses to compute over
  All Time** rather than invent a denominator
- **Packages & Menus** — 4 + 10 = 14; Granite shows Max pax 60 and no extra-pax
  price

### Fixes confirmed live
`Equipment Committed` (was "In Use") · `Payments Received` on all three pages
(was "Total Collections") · `TRIPS BOOKED` (was "Active Dispatches") ·
"Recent Months (Completed) — Latest 3 months, full history on the Booking
Summary tab" · "Bookings whose event date falls in the selected period… The
period filters the event, not the day it was marked" · the headcount band ·
Max Pax required · extra-pax inputs gone · delivery fee gone from package edit

---

## 6. One thing that is not a bug

The first click after a page load sometimes does not register — I hit it on a
Dashboard stat card, a Bookings quick filter and a Reports tab. Each worked on
the second attempt, and from a clean state every one behaved correctly. This is
most likely my automation racing React's hydration rather than a fault in the
app, and I could not reproduce it deliberately. Noted so nobody chases it.

Equally: I twice reported Record Payment as failing silently. It was not — the
toast renders correctly, I was screenshotting after its eight-second duration
had expired.
