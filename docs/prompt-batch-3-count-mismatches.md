# Batch 3 — Ten count-versus-list mismatches

This is the defect class the panel has already raised once (Rivera, PR-19: *"the
displayed number does not appear to match the number of corresponding
records"*), and that this project has now shipped and fixed **four** separate
times. These are the ten remaining instances.

They share one rule, so read it once and apply it ten times.

## The rule

**A number and the list it opens must be computed from the same set, with the
same predicate, in the same unit.** When they can't be — when the number
genuinely answers a broader question than the list — then the screen must say so
in words, next to the number, naming both.

Three sub-patterns appear below. Fix each instance by whichever of the two
remedies fits: **scope the count to match the list**, or **scope the list to
match the count**. Choose by asking which question the manager actually opened
that card to ask, and say in your write-up which you chose and why.

Files you may touch: `src/pages/Dashboard.jsx`, `src/pages/Payments.jsx`,
`src/pages/Bookings.jsx`, `src/pages/ShortOrders.jsx`, `src/pages/Equipment.jsx`,
`src/pages/Vehicles.jsx`, `src/pages/Reports/index.jsx`. Nothing else.

---

## Pattern 1 — a modal silently applies a date filter the card never had

### 3.1 · Dashboard "Pending Bookings & Orders" — HIGH
`Dashboard.jsx:274` (card) · `:555-576` (handler) · `:664` (`resetStatsFilters`) · `:698` (predicate)

The card counts every Pending booking, unfiltered. The handler calls
`resetStatsFilters()`, which sets `statsDatePreset` to `DEFAULT_DATE_PRESET`
(`'This Month'`), and `filteredStatsModalData` then drops any row whose
`event_datetime` falls outside the current month.

9 pending requests, 7 for November events → card reads **9**, modal shows **2**.
Pending requests are usually for future events, so this is the normal case.

**Remedy:** open this modal on **All Time**, the way `Payments.jsx`'s pending
card was already fixed. A manager clicking "Pending Bookings" wants all the
un-reviewed work, not this month's slice of it. Reports already solves the
general problem by passing the card's own preset into the modal
(`Reports/index.jsx:619`, `DetailModal.jsx:28-30`) — follow that mechanism.

### 3.2 · Dashboard "Events in the next 7 days" — HIGH
`Dashboard.jsx:582-610` · `:698` · `:1213`

Same invisible This Month predicate. Here it is worse, because the
`DateRangeFilter` is deliberately **not rendered** — the comment at `:1200`
asserts these three modals are "already scoped by date" so no filter applies.
The predicate at `:698` runs regardless, and `activeStatsFilterCount` returns 0,
so there is not even a "1 active" badge to hint at it.

On 28 September the window is 28 Sep – 4 Oct. Five events, three in October →
card **5**, modal **2**, no filter visible, no way to clear it.

**Remedy:** the card's 7-day window *is* the scope. Exempt these
already-scoped modal types from the `statsDatePreset` predicate at `:698`
entirely, so the comment at `:1200` becomes true instead of aspirational. Check
which other modal types that comment covers and make sure the exemption matches
the claim exactly — don't exempt more than it names.

### 3.3 · Payments "Awaiting Verification" — HIGH
`Payments.jsx:1330` vs `:508-516` · handler `:1295`

`pendingVerificationCount` is computed over the raw `payments` array. The status
card beside it and the table below are computed over `typeAndDateFiltered`. The
click handler only sets `activeTab`; it never clears the date filter.

Three proofs from last month, default This Month → the red hero card says **3**,
the status card directly beneath shows **0** with a red badge reading **3** next
to its own label, and the table is empty. Two contradictory numbers inside one
card, and the unverified proofs are unreachable unless the manager guesses to
change the date filter.

**Remedy:** clicking Awaiting Verification must reset the date preset to All
Time as well as switching tab — unreviewed proof is unreviewed regardless of
when it was submitted, and ageing proofs are exactly the ones that matter most.
`handlePendingClick` in the same file already does this; copy it.

---

## Pattern 2 — a badge and the filter it applies use different windows

### 3.4 · "Upcoming Confirmed" badge — HIGH
`Bookings.jsx:1276` vs `:681-693` · identical in `ShortOrders.jsx:1220` vs `:661-673`

```js
&& new Date(r.event_datetime) >= new Date()     // badge: from NOW
```
but the click handler sets `customStart` to today's local date, which
`getRangeBounds` turns into `T00:00:00` — from **local midnight**, with no upper
bound.

At 3 PM with two Confirmed events already run today: badge **3**, list **5**.

**Remedy:** make the badge count from local midnight, matching the filter. A
manager scanning "upcoming confirmed" is thinking in days, not in the current
instant, and today's earlier events are still today's work.

### 3.5 · "Today's Events" badge — MEDIUM
`Bookings.jsx:1275` vs `:664-676` · same in `ShortOrders.jsx:1219` vs `:644-656`

`todaysEventsCount` filters `statusCountRows`, which is **already narrowed** by
whatever `dateFilterField` and range the manager currently has set (`:185-194`).
The click handler then **replaces** both, forcing `event_datetime` and a custom
today..today range.

With "Filter by: Date Created / This Month" active, the badge counts bookings
*created* this month whose event is today (say 1); clicking shows every booking
whose *event* is today (say 4). With a range that excludes today, the badge reads
0 and the click opens a non-empty list.

**Remedy:** compute the badge on the same basis the click applies — event date,
today, ignoring the active filter. The badge is a fixed question ("what's on
today?"), so it should not move with an unrelated filter.

### 3.6 · Equipment and Vehicles section chips — HIGH
`Equipment.jsx:1703-1707` / `:2812` · `Vehicles.jsx:1345-1349` / `:2055`

The Overdue / Today / Upcoming chip counts are computed over **all** groups. The
lists beneath them additionally apply `assignmentDatePreset`, which defaults to
**This Month**.

Open the tab on 1 October with two overdue September events: chip reads
**`Overdue (2)`**, clicking it shows *"No trips match your search or filter."*

The authors already knew this hazard existed — the Overdue **cards** on both
pages explicitly reset the preset to All Time before navigating
(`Equipment.jsx:1974`, `Vehicles.jsx:1551`). The chips inside the tab were never
given the same treatment.

**Remedy:** compute each chip count against the same filtered set the list
renders, so the chip and its list agree by construction. Do this rather than
resetting the preset on click — a chip is a filter *within* the current view, and
silently widening the date range out from under the manager would be a second
surprise. An `Overdue (0)` chip under a This Month view is correct and honest.

### 3.7 · Vehicles "Trips today" vs the Day schedule — HIGH
`Vehicles.jsx:1078-1082` vs `:1658` (`dayTripCount`, `:1239`)

The card builds from page state, excluding only Rejected/Cancelled. The Day
schedule comes from `getDailyVehicleSnapshot`, whose booking query is
`.in('booking_status', ACTIVE_BOOKING_STATUSES)` (`utils/vehicle.js:745`) —
Approved/Confirmed only.

Every trip on a booking that has reached Completed is in the card and absent
from the list. This is the *normal* end state: `autoCompletePastEvents` flips a
Confirmed booking to Completed a few hours after the event, so today's own events
complete during today. Card says "Trips today 6"; the schedule below says
"2 events · 4 trips".

`vehiclesCommittedToday` (`:1085`) vs `dayCommittedVehicles` (`:1240`) diverge the
same way — fix both.

**Remedy:** include Completed bookings in the day snapshot. The snapshot already
deliberately keeps completed *assignments* (`utils/vehicle.js:696-697`) and then
loses them again through the booking-status filter, which reads as an oversight
rather than a decision. A trip that happened today is part of today's schedule.

---

## Pattern 3 — the number is right but means something other than its label

### 3.8 · Payments status-card amounts include unverified money — MEDIUM-HIGH
`Payments.jsx:508-516`

```js
amount: rows.reduce((sum, p) => sum + Math.max(0, p.amount_paid || 0), 0)
```

No `isUnverifiedPayment` filter. So the "All Payments" and "Downpayment" card
amounts sum **Pending Verification** and **Proof Rejected** money as pesos,
directly below a "Payments Received" card that correctly excludes it. A ₱25,000
proof rejected as a forgery still counts ₱25,000.

The explanatory line at `:1474` says "including ones not yet confirmed or since
cancelled" — that describes *booking* status, not payment verification, so it
does not cover this.

**Remedy:** the **counts** on these cards should keep including unverified rows —
that is what the Pending Verification card is counting and the tabs filter on.
The **amounts** must not. Show the verified amount, and where unverified money
exists, name it on its own line the way the Payments Received card names refunds:
`₱X verified · ₱Y awaiting verification`. Money that may never exist should never
be summed silently into a peso figure.

### 3.9 · Reports "Paid to Date" card vs its list — LOW
`Reports/index.jsx:207`

`_collectedBreakdown` only pushes bookings with `paid > 0`, while `totalCollected`
sums every booking's net paid. A booking whose refunds exceed its payments
contributes a negative to the card and is absent from the modal, so the list
cannot reconcile to the total above it.

**Remedy:** include any booking with a non-zero net paid, positive or negative, so
the list sums to the card. A negative row in that list is informative, not an
error — it is a booking that gave money back.

### 3.10 · Payments "Outstanding Balance" silently excludes Pending — HIGH
`Payments.jsx:392-406` vs `Reports/index.jsx:151` and `OverviewTab.jsx:67`

Both are event-anchored unpaid balances over the same period. Reports counts
every non-Rejected/Cancelled booking and now names the pending portion in its
sub-line. Payments fetches
`.in('booking_status', ['Approved','Confirmed','Completed'])` — dropping Pending
entirely — under a sub-line ("Unpaid for events this month") that claims no
exclusion.

Same words, two pages, two numbers. This is the drift `utils/reportMetrics.js`
was written to prevent, and neither page calls its function for this figure.

**Remedy:** make Payments match what Reports now does — include Pending in the
figure and name the pending portion in the sub-line, using the same wording
Reports uses (`₱X not collectable until approved`). Do not invent different
words for the same idea. If `reportMetrics` has a function that computes this,
call it from both pages rather than keeping two implementations.

---

## Acceptance for the whole batch

For **each** of the ten, demonstrate the before/after with a concrete case:

1. State the number the card shows and the number of rows its list shows, under
   the conditions named above, **before** your change.
2. State both **after**. They must agree, or the screen must name the difference
   in words.
3. Confirm the fix did not move any figure that was already correct.

Then run one sweep across every clickable card in the app that you did **not**
touch in this batch, and confirm each one's number still equals the row count of
the list it opens. Report that as a list of card → count → rows. If you find an
eleventh, report it; do not fix it in this batch.

## Do not

- Do not change any money **formula** — this batch is about scope and labels, not
  arithmetic. The one exception is 3.8, and there you are changing which rows are
  summed, not how.
- Do not add a new filter control, tab, or card.
- Do not "fix" a mismatch by removing the count. Every one of these numbers is
  load-bearing.
