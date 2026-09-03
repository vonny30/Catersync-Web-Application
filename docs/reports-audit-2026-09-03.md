# Reports page — terms vs. numbers, and grammar

3 Sep 2026. All eleven files behind the Reports page read line by line:
`index.jsx` (every derivation), the six tabs, both modals, `DateRangeFilter`,
`helpers.js` and `reportMetrics.js`.

The question asked of each label was not "is it the glossary word?" but **"does
this word describe the number underneath it?"** — which is a harder test, and
one this page mostly passes. The Vehicle Utilization tab in particular is the
best-written screen in the application.

Five labels fail it. Two captions describe a filter the code does not apply.
One panel silently shows three rows of a table it calls a summary. The rest is
grammar.

**Two corrections to my own earlier audits are in §6.** One of them reverses
advice I gave yesterday, so read that section before acting on the older file.

---

## 1. The headline: "In Use" is the wrong word for what Equipment counts

`index.jsx:489-494` builds the number:

```js
const deployedMap = {};
bookingEquipment
  .filter(d => d.booking?.booking_status && ACTIVE_BOOKING_STATUSES.includes(...))
  .forEach(d => { deployedMap[d.equipment_id] += d.quantity; });
```

That is **every unreturned assignment on an Approved or Confirmed booking** —
including 200 chairs promised to a wedding three weeks from now. Nothing about
it is date-aware.

The glossary is unambiguous about which word that is:

> **In Use** — Event happening; item is out.
> **Committed** — Promised to a booking on a date, not yet out.

The number is **Committed**. It is labelled **In Use** in nine places:

| File | Line | Text |
|---|---|---|
| OverviewTab | 102 | card label `Equipment In Use` |
| OverviewTab | 104 | `${n} of ${m} units in use` |
| OverviewTab | 107 | modal title `Equipment In Use` |
| OverviewTab | 111 | field label `In use` |
| EquipmentUtilizationTab | 27, 46, 118 | field label `In use` |
| EquipmentUtilizationTab | 37 | `{n} of {m} usable units in use` |
| EquipmentUtilizationTab | 42 | `…in good condition and not in use on a booking.` |
| EquipmentUtilizationTab | 54 | `{n} usable − {m} in use` |
| EquipmentUtilizationTab | 88 | `usable − in use = free` |
| EquipmentUtilizationTab | 101, 114 | column header `In use`; `currently in use, not yet returned` |

**The code itself already knows.** `EquipmentUtilizationTab.jsx:13`:

> *"Of the stock that can actually go out, **how much is committed**."*

The comment uses the right word; the label three lines below it does not.

**And the fix is already written, one tab over.** `index.jsx:539-542` — the D8
note on the vehicle side:

> *"'Currently dispatched' used to count any vehicle holding a Scheduled
> assignment on an active booking — which includes a van booked for a wedding
> three weeks out. **That is committed, not dispatched.**"*

Vehicles got that correction. Equipment never did.

→ **`In use` → `Committed` throughout both files**, and
`Equipment In Use` → **`Equipment Committed`**. Internal identifiers
(`deployed`, `totalDeployed`, `deployedMap`) stay — they are not read by anyone.

If you would rather the label stayed "In Use", then the *number* has to change
to match it, which means date-filtering `booking_equipment` the way
`getDispatchWindow` filters vehicles. That is a real piece of work and it is not
a finishing task. **Rename the label.**

---

## 2. "Active Dispatches" makes the same mistake — on the tab that fixed it

`VehicleUtilizationTab.jsx:109`, column header **Active Dispatches**, over
`activeDispatches`, which `index.jsx:524-535` defines as assignments with
`assignment_status === 'Scheduled'` on an active booking. Present **and**
future.

That is the exact quantity the card two rows above it refuses to call
dispatched. Its own drill-down says so at `:65`:

> *"A vehicle booked for a future event is **committed, not on the road**."*

So one tab, one screen, both readings of the same word.

→ column header → **Trips booked** — which is what `Vehicles.jsx` already calls
this number, so the two pages would finally agree. Field label at `:122`
likewise.

---

## 3. Two descriptions that describe code that no longer exists

### 3a. `OverviewTab.jsx:123`
> *"Live snapshot from the vehicle table (fleet) and vehicle_assign table
> (assignments currently marked Scheduled)."*

`dispatchedVehicles` has not meant that since the D8 fix. `index.jsx:549-557`
counts only assignments **whose dispatch window contains this moment**. The
drill-down explains the number the fix removed.

→ *"Live snapshot: vehicles whose dispatch window contains this moment."*
(`VehicleUtilizationTab.jsx:65` already has usable wording — reuse it.)

### 3b. `BookingSummaryTab.jsx:27`
> Card sub-line: *"Marked Completed in this period"*

The filter is `bookingsInEventRange.filter(b => b.booking_status === 'Completed')`
(`index.jsx:630`) — the **event** falls in the period. When it was marked is
never looked at. A booking completed last week for an event next month is not
in this figure, and one completed today for a June event is.

→ *"Completed, with an event in this period"*.

`:48` has the same fault in longer form — *"…marked as Completed, within the
selected period"* — where the comma lets "within the selected period" attach to
the marking rather than the event.

→ *"Only bookings marked Completed, with an event date in the selected period."*

---

## 4. A summary that shows three rows without saying so

`FinancialTab.jsx:233` — panel titled **"Monthly Booking Summary (Completed)"**.
`:248` renders `bookingSummaryData.slice(0, 3)`.

Nothing on screen says three. A manager with fourteen months of data reads a
panel called a summary and sees a quarter of it. The truncation is deliberate
and fine — the label is what is missing.

→ **"Recent Months (Completed)"**, or keep the title and add *"Latest 3 months —
full history on the Booking Summary tab."*

---

## 5. Everything else, by tab

### 5.1 Overview
| Line | Now | Should be |
|---|---|---|
| 112 | field `Total fleet` (equipment) | **Total units** — a fleet is vehicles; `:126` uses the same words for the actual fleet |
| 54 | `Paid to Date` | see §6.1 — **keep**, but the sub-line is carrying it |
| 182 | *"Each share is of its own product line's revenue."* | *"Each share is measured against its own product line's revenue."* — the current line has no verb |
| 64, 108 | `month(s)`, `equipment type(s)` | the app elsewhere writes `payment${n === 1 ? '' : 's'}`; pick one |

### 5.2 Financial
| Line | Now | Should be |
|---|---|---|
| 41 | `Total Collections` | **Payments Received** — the glossary term for this exact figure, and the name `reportMetrics.js` gives it |
| 110 | `Monthly Collections` | **Payments received by month** |
| 134 | *"Each bar is the total verified payments for that month."* | Number disagreement, and *total* is wrong: refunds are included, so bars can go negative. → *"Each bar is the net of verified payments for that month, after refunds."* |
| 147 | column `Payments` (an integer count, beside a peso column) | **Count** — the drill-down at `:160` already says "Number of payments" |
| 186 | column `Booking` in Refunds, showing a reference that may be a short order | **Reference** |
| 94 | *"…of contract value paid for these events"* | *"…of contract value collected for these events"* |

### 5.3 Menu & Packages
| Line | Now | Should be |
|---|---|---|
| 186 | *"**1** of 5 packages **account** for…"* | Subject–verb disagreement whenever the Pareto row is the first. → `account{paretoIndex === 0 ? 's' : ''}`. (The neighbouring `packageMix.length === 1` branch is dead — `showPareto` requires ≥ 4 rows.) |
| 186 | *"account for the **first** 80%"* | *"account for 80% of package revenue"* — "first" reads as a sequence, not a share |
| 155 | badge `Tail` | **Lower 20%** — "tail" is a statistics word |
| 86 | column `Bookings`, counting short orders too | **Bookings & orders** — the settled umbrella. `Bookings` alone is wrong on the Short Orders row |
| 194 | *"Short order items measured against total menu item revenue."* | verbless. → *"Each short order item is measured against total menu item revenue."* |
| 151, 217 | curly apostrophes (`package’s`, `order’s`) | straight, matching the rest of the file |

### 5.4 Equipment Utilization
Beyond §1:

| Line | Now | Should be |
|---|---|---|
| 23 | modal title `Fleet Utilization` (equipment) | **Equipment Utilization** |
| 35 vs 23 | card says `Utilization`, its own modal says `Fleet Utilization` | one name |
| 52 vs 41 | card says `Free Now`, its own modal says `Available Equipment` | one name |
| 44, 52, 54, 102, 119 | `Free` / `Free Now` / `Free now` | **Available** — retired word, and this file uses *Available* elsewhere |
| 88 | *"usable − in use = free"* | *"usable − committed = available"* |
| 115 | badge `Available` on any row under 80% utilised | Misleading at 79%. → **Within capacity** |

### 5.5 Vehicle Utilization
Beyond §2 — and this tab is otherwise the model for the rest:

| Line | Now | Should be |
|---|---|---|
| 96 | `Vehicle Fleet Status` | **Fleet Status** |
| 119, 133 | renders `{v.status}` raw → shows `Maintenance` | route through `RESOURCE_STATE` → **Under Maintenance**, as `Vehicles.jsx:895` does |
| 82, 90 | *"not counted as free"*, *"Free for a new dispatch"* | **available** |
| 22 vs 51 | `Fleet utilization` vs `Fleet Size` | casing drift inside one file |
| 34 | *"÷ {n} available"* — available *what?* | *"÷ {n} vehicle-hours available"* |

### 5.6 Booking Summary
| Line | Now | Should be |
|---|---|---|
| 63 | column `Total Completed Bookings` on per-month rows | **Completed Bookings** — "Total" belongs to the `tfoot`, where it already is |
| 47 | `Historical booking summary` | Sentence case among six Title Case panel titles; and *historical* does no work. → **Booking Summary** |
| 25 vs 63 | card `Completed Events`, column `Completed Bookings` | same rows, two nouns |

### 5.7 Detail modal
| Line | Now | Should be |
|---|---|---|
| 155 | *"No records found for this category."* | *"No bookings found."* — *records* is a retired umbrella |
| 157 | *"No records match your search/filter."* | *"No bookings match your search or filters."* — the slash is not prose |
| 202 | `Total:` | `Total`, matching every other footer on the page |
| 137 | `Filter by event date:` | drop the colon; no other filter label has one |

### 5.8 Page header
`index.jsx:690` — **`Financial & Reports`**. Financial is one of the *six tabs
inside this page*. The sidebar says **Reports**.

→ **Reports**. (Also in the page-labels audit, §B2 — restated here because it is
the first thing on the page.)

---

## 6. Corrections to my earlier audits

### 6.1 `Paid to Date` — I was wrong; do **not** rename it
`page-labels-audit-2026-09-03.md` §A8 said to rename **Paid to Date** →
**Payments Received**. That is wrong, and acting on it would break the page.

They are two different figures, deliberately:

- `paidAgainstEvents` — payments against bookings whose **event** falls in the
  period. Event-anchored. This is *Paid to Date*.
- `paymentsReceived` — cash received in the period by **payment date**.
  Cash-anchored. This is what *Total Collections* shows.

`FinancialTab.jsx:13-18` spells out why they must not be conflated, and
`index.jsx:195-198` records that conflating them is what made this page disagree
with the Dashboard.

The correct move is the **opposite assignment**: leave "Paid to Date" alone and
rename **Total Collections → Payments Received** (§5.2). Sharpen the sub-line to
*"Paid so far against those events"* if you want it clearer.

### 6.2 `deployed` → `in use` was the wrong target
`terminology-audit-2026-09-03.md` §1.3 said to change *deployed* to *in use*.
That replaced one wrong word with another — see §1. The correct word is
**Committed**. If that change has already been applied, §1 above is the
follow-up; if not, skip §1.3 of the older file and do §1 of this one instead.

---

## 7. What this page gets right

Worth writing down, because most of it is unusual and all of it is at risk of
being "tidied" by someone who has not read the comments:

- **The Vehicle Utilization tab.** It distinguishes *on the road now* from
  *booked now or later*, prints the division that produced every percentage,
  and — over "All Time" — **refuses to show a utilization figure at all**
  because there is no finite denominator. That refusal is the single best thing
  on the page. Do not replace it with a zero.
- **The Menu Item Mix footer.** Menu items + delivery fees + unattributed =
  short order revenue, with a sentence explaining the third line when it
  appears. Three figures that reconcile on screen.
- **Every share column states its denominator** and sums to 100%, with Category
  Demand explicitly saying its shares *exceed* 100% and why.
- **The closing note** (`MenuPerformanceTab:335`): *"Revenue here is contract
  value — what each booking is worth in total, whether or not it has been
  paid."* One sentence that stops the most likely misreading of the whole tab.
- **`monthSortKey` / `monthLabel`** kept apart so a localised month string is
  never parsed back into a date.

---

## 8. Applying this

Five groups, and only the first changes a number's meaning:

1. **§1 + §2** — the committed/in-use fixes. ~15 strings across three files.
2. **§3** — two stale descriptions. 3 strings.
3. **§4 + §5.8** — panel and page titles. 3 strings.
4. **§5** — the remaining per-tab table. ~30 strings.
5. **§6** — undo one line of my earlier advice.

Nothing here touches a query, a filter, a derivation or a stored value. §5.5's
`{v.status}` fix routes an existing value through an existing map; everything
else is a string literal.
