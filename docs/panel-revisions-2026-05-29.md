# Panel revisions — 1st Increment oral defense, 29 May 2026

Source: `CF3_MinutesForm_Group2_1stIncrement.docx`. Panel: Asst. Prof. Janice
Antoniette V. Förster, Asst. Prof. Maria Lourdes S. Curativo (Chair), Asst.
Prof. Albert Geroncio Y. Rivera. Content adviser: Asst. Prof. Allan V. Credo.

Every panel comment is reproduced verbatim below, mapped to the exact files that
implement it. **A large share was already closed by work done 21 Aug 2026** —
those are listed with commit evidence in §5 so they can be demonstrated rather
than redone.

## How to use this file

Work top-down: §2 (open work) → §3 (needs a decision from Vaughn first) → §4
(mobile repo, not this one). Each item states the files, the change, and how to
tell it is done. Do not start §3 items without an answer.

Constraints still in force from `HANDOFF.md`: **no schema changes**, every money
figure comes from `utils/reportMetrics.js`, every stock figure from
`getStockBreakdown` in `utils/equipment.jsx`, and all files are written **LF**.

## Status legend

| | Meaning |
|---|---|
| **OPEN** | Not addressed. Actionable now. |
| **DECIDE** | Needs Vaughn's answer before coding. |
| **DECIDED** | Answered. The decision and its acceptance criteria are written down; the code is still owed. |
| **MOBILE** | Belongs to the customer mobile app, not this repo. |
| **DONE** | Already closed. Evidence given for the panel. |

---

## 1. Summary

| ID | Module | Panel | Comment (short) | Status |
|---|---|---|---|---|
| PR-01 | Payments | Förster | Password verification before sensitive payment actions | DONE (moot — payments can no longer be edited or deleted at all; verifying still asks for a password) |
| PR-02 | Payments | Förster | Filter by date range / month and by method | DONE |
| PR-03 | Payments | Curativo | Distinguish downpayment / partial / full | DONE |
| PR-04 | Payments | Curativo | Manager confirms payment after proof received | DONE |
| PR-05 | Equipment | Förster | Total available equipment for a selected date | DONE |
| PR-06 | Equipment | Förster | Availability keyed to the booking/event date | DONE |
| PR-07 | Equipment | Förster | Damaged stock must not count as available | DONE |
| PR-08 | Booking Request | Förster | Proof of payment comes after manager approval | DONE (web side) / **MOBILE** |
| PR-09 | Booking | Curativo | No booking from past dates | DONE (web) / **MOBILE** |
| PR-10 | Booking | Curativo | Order records by recency of processing | DONE |
| PR-11 | Booking | Curativo | Event Type shows wrong data on review page | **MOBILE** |
| PR-12 | Booking | Curativo | Customer cancel must read Cancelled, not Rejected | **MOBILE** (contract below) |
| PR-13 | Login | Förster | Block concurrent login from another device | DONE |
| PR-14 | Login | Curativo | Password visibility icon is incorrect | DONE |
| PR-15 | Dashboard | Rivera | "Upcoming Event (7 Days)" label is ambiguous | DONE |
| PR-16 | Bookings | Rivera | Bookings with a downpayment can still be deleted | DONE (built; §3 text below was stale until 5 Sep) |
| PR-17 | Payments | Rivera | "Pending Balance" unclear | DONE |
| PR-18 | Payments | Rivera | "Net Collected" unclear | DONE |
| PR-19 | Payments | Rivera | "Fully Paid" count doesn't match the records | DONE |
| PR-20 | Recording Payments | Rivera | Clarify the payment workflow | DONE |
| PR-21 | Recording Payments | Rivera | Clarify the purpose of editing payments | DONE (editing was removed — that is the answer) |
| PR-22 | Recording Payments | Rivera | Why some payments are editable and others not | DONE |
| PR-23 | Recording Payments | Rivera | **Refunds must not be classified as payments** | DONE |
| PR-24 | Equipment | Rivera | "Free to Use" → "Available" | DONE |
| PR-25 | Equipment | Rivera | Availability bar is wrong | DONE |
| PR-26 | Equipment | Rivera | Total count ≠ available count when assigning | DONE |
| PR-27 | Equipment | Rivera | BK-067 shows returned but was never assigned | DONE (built; BK-067 itself no longer exists in the data) |
| PR-28 | Vehicles | Rivera | "Free to Use" → "Available" | DONE |
| PR-29 | Menu Performance | Rivera | Clarify how it is calculated | DONE |
| PR-30 | Menu Performance | Rivera | Orders vs trays as units | DONE |
| PR-31 | Menu Performance | Rivera | How packages vs specific menu items are treated | DONE |
| PR-32 | Menu Performance | Rivera | Should a Bronze Package sale count toward Beef Caldereta? | **DECIDED** (build pending) |
| PR-33 | Equipment | Förster | What is the policy for equipment return? | DONE |
| PR-34 | Equipment | Adviser | "Does the total number of equipment really matter?" + see upcoming events with their packages and assigned equipment | DONE |
| PR-35 | Booking | Förster | Simulate a booking for another month; check it works and what it does to the dashboard | **OPEN** (test, not code) |
| PR-36 | Booking | Förster | Fix grammar of "Quick Looks" | DONE (the label is now "Quick filters") |
| PR-37 | Booking | Förster | Date Filter: the first date must be earlier than the second | DONE |
| PR-38 | Dashboard | Förster | Only confirmed & completed should count as revenue; no collectables/payables | DONE — applied literally, 5 Sep |
| PR-39 | Dashboard | Förster | The filter on the dashboard didn't work | DONE |
| PR-40 | User | Förster | There should be no Duplicate Names | **DECIDED** 5 Sep — warn, do not block (build owed) |

Counts: **27 done**, **2 open**, **2 need code against a made decision**, **2 mobile**, 2 split.

> **PR-35 to PR-40 were missing from this file until 5 Sep 2026.** The minutes
> carry 40 items; this file tracked 34. The whole last block of Förster's
> comments — the Booking, Dashboard and User Module rows on page 5 of the form —
> was never entered, so nothing was checking them. Four of the six turned out to
> be satisfied already. Two were not. §3.5 has each one.

---

## 2. Open work

### PR-01 · Password verification before sensitive payment actions

> "Increase security, especially in the deletion of payment records. Require
> **manager/password verification** before sensitive payment actions such as
> deletion or approval." — Förster

**DONE, and moot on the deletion half** — a later panel note (paraphrased:
"a payment should not be edited or deleted at all, since recording one
already goes through pending verification or manual entry — there's no
legitimate reason to alter or remove one afterward") removed payment
edit/delete entirely rather than gating it behind a password. There is no
delete-payment action left anywhere in the app (`Payments.jsx`,
`BookingDetails.jsx`, `ShortOrderDetails.jsx`, and the shared
`usePaymentHandlers.js` hook all had the edit/delete code paths removed) — a
refund is recorded as its own new (also un-editable) entry instead.
Verification already asks: `Payments.jsx` `handleVerifyConfirm` calls
`requestPasswordConfirm` before the `payment` update; rejecting a proof does
not prompt, since it takes nothing in.

### PR-03 · Distinguish downpayment / partial payment / full payment

> "The system should properly distinguish **down payment**, **partial payment**,
> and **full payment**, and accurately update the payment status based on the
> amount paid." — Curativo

The amount-driven part already works: `Payments.jsx:632` derives
`finalStatus = amount_paid >= remainingBeforeThis ? 'Fully Paid' : 'Downpayment'`.
What is missing is the middle term — every non-final payment reads "Downpayment"
even when it is the third one against the same booking.

`pay_status` is a stored column and **must not gain a new value** (no schema
changes). Derive the third state for display only:

| Condition | Show |
|---|---|
| First verified payment on the booking, below the full balance | **Downpayment** |
| A later payment that still leaves a balance | **Partial payment** |
| Payment clears the remaining balance | **Fully Paid** |

**Files:** `src/utils/payments.js` (add the derivation beside
`isUnverifiedPayment`), then `src/pages/Payments.jsx`, `src/pages/BookingDetails.jsx`,
`src/pages/ShortOrderDetails.jsx` for display.
**Change:** export `describePaymentKind(payment, priorVerifiedPayments, bookingTotal)`
returning `'Downpayment' | 'Partial payment' | 'Fully Paid'`. Stored values are
untouched; only the badge text changes.
**Acceptance:** a booking with three payments reads Downpayment → Partial payment
→ Fully Paid; `pay_status` in the database still only ever holds `Downpayment`
or `Fully Paid`; the Payments status tabs still filter on the stored value.

**DONE.** `describePaymentKind(payment, priorVerifiedPayments, bookingTotal)`
already existed in `src/utils/payments.js` and was already wired into
`Payments.jsx`. It is now also wired into `BookingDetails.jsx` and
`ShortOrderDetails.jsx`'s payment-history tables (both previously showed the
raw two-value `pay_status` instead), so the frozen-per-payment label is
consistent everywhere a payment history is shown — including the grouped
Payments table added for the one-row-per-booking view (each row shows the
label frozen at the time its own most recent payment landed, not
recalculated against the booking's current total).

### PR-15 · "Upcoming Event (7 Days)" label

> "Clarify whether the 7-day period includes the current day and determine a
> more appropriate label based on the actual date range." — Rivera

The query at `Dashboard.jsx:226-227` is
`.gte(event_datetime, today 00:00:00)` and `.lt(event_datetime, today+7d 00:00:00)`
— so it **does include today**, and covers today plus the following six days.

**Files:** `src/pages/Dashboard.jsx` — the card and the modal title.
**Change:** both read `Upcoming Events (7 days)`. Replace with
**`Events in the next 7 days`** and add a sub-line naming the window so the
range is stated rather than inferred.
**Acceptance:** the label names the window; the modal title matches the card;
an event later today is included and visible in the drill-down.

**DONE** — Vaughn asked for **both** ends named, not just the end date, so the
sub-line reads **`Aug 23 – Aug 29, 2026`** rather than "Today through …". A
manager reading it never has to know what today's date is or count forward.
`upcomingWindowLabel()` builds it, and drops the year from the start when both
ends fall in the same year. The window length is now the named constant
`UPCOMING_WINDOW_DAYS = 7`, read by the label and by **both** queries — the
hard-coded `7 * 24 * 60 * 60 * 1000` that could drift away from the label is
gone. Card and modal share the one helper.

### PR-19 · "Fully Paid" count does not match the records

> "Review the **"Fully Paid"** count, as the displayed number does not appear to
> match the number of corresponding records." — Rivera

Root cause found: **the Payments page fetches with no row limit.**
`Payments.jsx:146` (`payment`) and `:174` (`booking`) have no `.range()` and no
`.limit()`. PostgREST caps a response at the project max-rows (Supabase default
1000), so once either table passes that, the page silently computes its cards
from a truncated set. This is the same defect already fixed in Reports
(`9bcdab8`).

Compounding it, `fullyPaidCount` (`Payments.jsx:212-216`) counts **bookings**
whose verified payments cover the total, while the card sits in a row of
payment-level cards — so even with complete data the number is not the count of
any list the manager can open.

**Files:** `src/pages/Payments.jsx`
**Change:** (a) page both fetches the way `Reports/index.jsx` `fetchAll()` does —
`.range()` with a stable `.order()` on the primary key, since Postgres gives no
ordering guarantee without `ORDER BY`; (b) make the card's drill-down list the
same bookings the count counts, so the two agree by construction.
**Acceptance:** with more than 1000 payment rows the figures are unchanged from
a full fetch; clicking "Paid in Full" opens a list whose row count equals the
card.

**DONE — verified 30 Aug 2026.** Both halves are in place:

- (a) `Payments.jsx` pages both fetches through `fetchAllRows`, each ending its
  ordering on `booking_id` / the primary key, so neither can be silently
  truncated at the 1000-row cap.
- (b) The count and its drill-down are built from the same two arrays with the
  same predicate — `paid >= total_amount && paid > 0`, excluding
  `UNVERIFIED_PAY_STATUSES` — and the booking fetch is already restricted to
  `Approved`/`Confirmed`/`Completed`, so a cancelled booking cannot appear in
  one and not the other. Re-checked for that specific divergence; it does not
  occur.

### PR-22 · Why some payment records can be edited and others cannot

> "Explain why some payment records can be edited while others cannot." — Rivera

The rule exists and is correct — `isPaymentLedgerLocked` in
`src/utils/payments.js`: the ledger locks once a booking is `Confirmed`,
`Completed`, `Cancelled` or `Rejected`. `paymentLockedMessage` already writes a
plain-language reason. It just isn't visible until you try.

**Files:** `src/pages/Payments.jsx`, `src/pages/BookingDetails.jsx`,
`src/pages/ShortOrderDetails.jsx`
**Change:** render the disabled Edit/Delete controls with the lock reason as a
visible tooltip and a small lock icon, the way the Equipment return button
already shows its own trap. Don't hide the buttons — a hidden control teaches
nothing.
**Acceptance:** hovering a locked payment's Edit button explains why without
clicking; an unlocked one has no lock icon.

**DONE** — `58eda4e`. The lock icons and disabled styling were already in place
on all three pages; the gap was that each tooltip was a hand-written string that
stopped at "payments can't be edited once a booking is Cancelled" and left out
the part that matters — a refund is still possible, just as its own ledger
entry. All six tooltips now call `paymentLockedMessage()`, the same text the
toast already used, so there is one wording to maintain. The util's article was
also fixed so `{ noun: 'order' }` reads "an order".

### PR-23 · Refunds must not be classified as payments

> "**Refunds should not be classified as payments**, as a refund represents money
> returned rather than a payment received." — Rivera

Confirmed. `Refund` currently sits in the **payment method** dropdowns, beside
Cash, GCash and Bank Transfer — mixing a *kind of transaction* with a *way of
paying*. A refund is a negative `amount_paid` row whose method is still Cash or
GCash or Bank Transfer.

- `src/pages/Payments.jsx:1192` and `:1539` — `<option value="Refund">Refund</option>`
- `src/pages/Dashboard.jsx:988` — same
- `src/pages/Payments.jsx:26` and `:92` — the filter's own comments list Refund
  as a method

**Change:** remove `Refund` from every **method** list. Add a separate
**Transaction type** filter with `All / Payments / Refunds`, matching on the sign
of `amount_paid`. Label refund rows "Refund" in the type column, never in the
method column. `utils/reportMetrics.js` already separates `refundsIssued` from
`paymentsReceived` — reuse that vocabulary rather than inventing new words.
**Acceptance:** the Method filter offers only real methods; filtering to Refunds
returns exactly the negative rows; a refund made by GCash reads method GCash,
type Refund.

**DONE** — `d952d58`. `Refund` is gone from every method dropdown on both
Payments and Dashboard, and a `transactionTypeFilter` (All / Payments / Refunds)
now splits on the sign of `amount_paid`.

### PR-27 · BK-067 shows returned but was never assigned

> "For booking **BK-067**, clarify the equipment status, as the equipment appears
> as **returned** but has not yet been manually assigned/updated accordingly."
> — Rivera

Likely cause, to confirm against that record: the daily snapshot in
`src/utils/equipment.jsx` falls back to the **package equipment template** when a
booking has no manual `booking_equipment` rows. Those estimated lines carry
`source: 'estimated'` and have no assignment to return, which is why the row
detail modal says "No return action". If any view renders a returned/assigned
badge for an estimated line, it is claiming a state that does not exist.

**Files:** `src/utils/equipment.jsx` (snapshot), `src/pages/Equipment.jsx`
(availability row detail modal, ~the `evCanReturn` block)
**BUILT — verified in the code 5 Sep 2026.** `Equipment.jsx:3041-3042` renders
*"Estimated from package (not yet manually assigned)"* for any line with
`source === 'estimated'` (set at `utils/equipment.jsx:629`). The diagnosis below
was right and the fix is in.

**BK-067 itself can no longer be reproduced** — the database was reset and holds
one booking, BKG-105. Demonstrate the fix on any booking with no manual
assignment rather than on that reference.

**Change (as specified, now built):** ensure every estimated line renders
as **"Estimated from package — not yet assigned"** and never shows an assignment
status or a return control. Only rows backed by a real `booking_equipment` row
may show Assigned / In Use / Returned.
**Acceptance:** a booking with no manual assignment shows estimated quantities
and no status badge; assigning equipment to it replaces the estimate with a real
row that does carry a status.

**Investigated 22 Aug 2026 — NOT REPRODUCIBLE against current data. Do not
"fix" this blind; get the panel's screenshot first.**

Queried the live database directly:

- `BKG-067` (`fa9b74e9…`, Package, Confirmed, event 20 Aug 2026) has **zero
  `booking_equipment` rows**, and its package has **zero `package_equipment`
  template rows** — so it generates no real lines *and* no estimated ones.
  There is currently nothing on that booking that could display a status.
- Across the **entire `booking_equipment` table there are zero rows with
  `returned = true`**, and none missing `assigned_at` or returned before being
  assigned. The "appears as returned" symptom cannot be produced from the data
  as it now stands. The records have evidently changed since 29 May.

The defensive behaviour this item asks for is **already implemented**:
`Equipment.jsx` renders `ev.assignment_id ? <Return> : "No return action"` and
tags `source === 'estimated'` lines "Estimated from package (not yet manually
assigned)". Estimated lines therefore never show an assignment status or a
return control, which is exactly the acceptance condition above.

Two things found while looking, neither of them this bug:

- Three bookings sit Confirmed with a past event date (`BKG-067`, `SO-022`,
  `SO-023`). **Working as designed** — `autoCompletePastEvents` completes only
  fully-paid records; all three are part-paid (7000/12500, 5000/6800,
  1000/1500) and are deliberately left for a human to chase. `hasUnpaidPastEvent`
  already flags them in the UI.
- Auto-complete is passive: with no scheduled job in this stack it runs only
  when an admin loads a page. That is documented at the top of
  `utils/autoComplete.js` and is a design constraint, not a defect.

### PR-20 / PR-21 · Document the payment workflow and the purpose of editing

> "Clarify the payment workflow, as it is assumed that a booking is already
> confirmed before a payment is recorded." / "Clarify the main purpose of
> **editing payments**." — Rivera

These are documentation, not code. The workflow the system actually implements —
and the one the panel asked for in PR-08 — is:

```
Customer submits booking request
  → Manager reviews and approves        (booking_status: Pending → Approved)
  → Customer submits proof of payment
  → Manager verifies the proof          (pay_status: Pending Verification → Downpayment | Fully Paid)
  → Booking is confirmed                (booking_status: Approved → Confirmed, ledger locks)
```

Payments become possible at **Approved**, not at Confirmed — `BookingDetails.jsx`
already gates the payment panel on it ("Approve this booking to enable
payments"). Confirmation is the *consequence* of a verified payment, not a
precondition for one.

Editing a payment exists to correct a **recording mistake** by the manager —
wrong amount typed, wrong method selected — before the ledger locks. It is not a
way to change what a customer owes; that is what the approval-time fee
adjustment is for.

**Files:** add both statements to `docs/HANDOFF.md` under a "Payment workflow"
heading, and surface the second as helper text in the Edit Payment modal.

**DONE — 30 Aug 2026.** `docs/HANDOFF.md` now carries a **Payment workflow**
section with the sequence above and the Approved-not-Confirmed point.

The second half resolved differently from how it was written here, because the
prescription predates the decision it depends on: **payment editing was removed
entirely.** There is no Edit Payment modal to add helper text to. The answer to
"what is the purpose of editing payments" is that there isn't one — a payment
row exists only because a manager recorded it or verified a proof, so the
ledger is append-only: corrections are new entries, money going back is a
refund (PR-23), and a change to what is owed is the approval-time fee
adjustment. HANDOFF states that with the table of what to do instead. The
modal's label still read "RECORD / EDIT PAYMENT" and has been corrected.

### PR-33 · Equipment return policy

> "What is the policy for equipment return? Right after use? Within 12 hrs?
> Within 4 hrs? etc." — Förster

This item was in the 1st-increment minutes but had never been logged in this
tracker, so it went unanswered while the other Equipment items were closed.

**DONE.** The system had *half* a policy, implemented but never stated: a
lock after the event start before Return could be recorded (3 hours then, 4
now). Nothing
defined when equipment was actually **due back**, so "Overdue" just meant the
event date had passed.

The stated policy, now written at the top of `src/pages/Equipment.jsx` and
shown to the manager on the Active Assignments tab:

> Equipment is due back **within 24 hours of the event start**. Returns can be
> recorded from **4 hours** after the event starts, and anything still out past
> the 24-hour mark is flagged **Overdue**.

Two distinct moments, which the code previously conflated:

| Moment | When | Meaning |
|---|---|---|
| Opens | event start + 4h | Earliest a return can be recorded — the moment the collection run sets off. Was 3h; moved when the dispatch model was calibrated with PG's on 30 Aug 2026 (they collect 4-7 hours after an event, and the early end is taken). Now imported from `PICKUP_GRACE_HOURS` rather than restated, because the two copies had already drifted apart. |
| Due | event start + 24h | The deadline — still out past this and it is Overdue |

**Defect this exposed:** overdue was computed as `event_datetime < now` while
Return only unlocked at the grace time. That left a **window where an
assignment was flagged Overdue in red, and listed in the Overdue Returns
panel, while its own Return button was still locked** — the manager was told
to act on something the system would not let them act on. Anchoring overdue to
the 24-hour due time removes the contradiction by construction, since Due is
always well after Opens. The same rule now backs the Active Assignments tab
badge count, which had been counting from the event date while the rows
counted from the deadline.

**Also:** the OVERDUE badge now reads `OVERDUE · 3d` and carries the exact due
timestamp on hover — one day late and a week late are different problems.

**Not changed:** `src/pages/Vehicles.jsx` carries the same event-date overdue
rule and its own copy of `getReturnAvailability`. Vehicles were out of scope
here; if the same policy should apply to the fleet, that is a follow-up.

### PR-34 · Equipment prep view — packages and assignments per upcoming event

> "Does the total number of equipment really matter?" and "how to see if there
> are upcoming events — it should see which packages and what equipment are
> assigned for that." — Adviser

**DONE.** Both halves are the same point: the page was reporting **stock** when
the manager's actual job is **preparation**.

**"Total stock owned" was a vanity figure.** Owning 500 chairs says nothing
about whether Saturday's event is ready, and there is no action a manager takes
in response to it. It moved to the Inventory tab as reference context (where
"what do we own" is the question being asked), and the headline slot it
occupied now shows **Events needing prep** — how many upcoming events are
missing equipment — which is actionable and links straight to them.

**New Upcoming tab** (now the default tab, since preparing for what's coming is
the job this page exists for). For each event in the next 14 days it shows the
booking ref, customer, **the package booked**, pax count, venue, date, and a
countdown — then expands to a per-item breakdown:

| Equipment | Required | Assigned | Status |
|---|---|---|---|
| Chair | 70 | 70 | Complete |
| Table | 9 | 4 | 5 to assign |

with a **READY** / **N UNITS SHORT** badge per event and an Assign button
pre-filled with that booking.

**Required** is derived from the package's equipment template at that event's
pax count. The rule was extracted into a new pure `deriveEquipmentDemand()` in
`src/utils/equipment.jsx`, and `computeEquipmentDemand()` (used by
`allocateEquipmentForBooking`) now delegates to it — so what the prep view
calls "required" can never drift from what the Assign action would actually
allocate. Verified: 70 pax → 70 chairs (1 pax/unit), 9 tables (⌈70/8⌉), 2 arches
(fixed decorations don't scale with pax); empty/null templates return `{}`
rather than throwing.

Rows are the **union** of required and assigned, not just the template, so
equipment assigned beyond what the package lists still shows (as "+N extra")
instead of being invisible. Packages with no equipment template say so
explicitly rather than silently showing a blank Required column.

**Assignment window: Approved only.**

| Status | Assign equipment? | Why |
|---|---|---|
| Pending | No | Un-reviewed request; approval is what allocates |
| **Approved** | **Yes** | Accepted, not yet locked — the window for allocation and adjustment |
| Confirmed | No | Booking is locked; resources settled |
| Completed / Cancelled / Rejected | No | Terminal |

Expressed as `ACTIVE_BOOKING_STATUSES.includes(s) && !isPaymentLedgerLocked(s)`
rather than a hardcoded `'Approved'`, so it keeps following the lifecycle if
either shared list changes. Verified it resolves to exactly `['Approved']`.

The Confirmed half of this was **already the established rule** — 
`BookingDetails.jsx` refuses to assign, edit, or remove equipment once
`isPaymentLedgerLocked` (Confirmed/Completed/Cancelled/Rejected), with the
message "equipment can't be assigned once a booking is Confirmed". The
Equipment page's own Assign modal did not follow it, so the same action gave
two different answers depending on which screen it was started from. Now
enforced in both the booking picker and `handleAssignSubmit` (the picker only
hides ineligible bookings; a selection made before another manager confirmed
it would otherwise still submit) — matching how BookingDetails guards its own
equipment handlers.

Confirmed events **remain listed** in the prep view: they are still events to
prepare for, and a shortage on one matters precisely because it can no longer
be fixed by assigning. Their Assign button is replaced by a "Locked —
Confirmed" chip, plus a "Short, and no longer assignable — resolve on the
booking itself" note when there is an actual gap.

**Why Pending is blocked.**

Equipment is allocated by `allocateEquipmentForBooking` at the moment of
**approval** (`useApprovalHandlers.js`). A Pending booking therefore has no
allocation *by design*, not by oversight — so listing pending requests in the
prep view reported every un-reviewed inquiry as "N units short" and made the
prep count read as outstanding work when the real next step is to approve or
reject it. Verified against live data: of 4 bookings in the 14-day window, 2
(Confirmed) are genuine prep and 2 (Pending) were inflating the count.

Assigning equipment to a Pending booking is now blocked at the Assign modal's
booking picker. This closes a real defect rather than just tidying the flow:
`booking_equipment` has no status column, so such a row **appeared** in Active
Assignments and History, but every availability query filters assignments to
`ACTIVE_BOOKING_STATUSES` (`activeRealAssignments` in `checkEquipmentAvailabilityImpact`,
and the per-date snapshot). The reserved units therefore still read as free
everywhere else — a **ghost reservation** that holds nothing, letting the same
stock be promised to a second event.

Blocking it costs nothing legitimate: approval auto-allocates from the package
template, so assigning beforehand only duplicates work about to happen — or
strands rows if the request is rejected. The genuine need it might seem to
serve — "can I even fulfil this before I approve it?" — is a *read*, and is
already answered by the availability preview
(`getEquipmentAvailabilityPreview`, shown live in the approval flow and the
Assign modal) without reserving anything.

Pending requests in the window are still surfaced on the Upcoming tab as a
count ("N awaiting approval — equipment is allocated once approved"), so the
manager knows work is coming without it polluting the shortage figures.

**Verification limit:** the demand rule is unit-verified and the
Approved/Confirmed split is verified against live booking data, but the
required-vs-assigned view could not be checked end to end against real
equipment rows — `equipment`,
`booking_equipment`, and `package_equipment` all return 0 rows to an
unauthenticated client (HTTP 200, no error, i.e. RLS filtering), and no manager
login was available in the session. Worth a look with real data: if
`package_equipment` is genuinely empty in production, every event will show the
"no equipment template" state and Required will be blank until package
templates are set up under Packages & Menus.

---

## 3. Decisions — answered 2 Sep 2026, some with code still owed

Every item here has Vaughn's answer recorded against it. PR-14 is built; PR-16
and PR-32 are decided with acceptance criteria and the code outstanding — see
§6.

### PR-10 · Order of booking records

> "The order of booking records may be based on the recency of processing." — Curativo

Current: `Bookings.jsx:191-192` and `ShortOrders.jsx:168-169` sort
`status_order ASC, book_datetime ASC` — grouped by status, **oldest first**
inside each group, which is a work-queue order (act on the longest-waiting).
"Recency of processing" suggests newest first.

There is no `updated_at` column, so "processed" cannot be read directly; the
closest available proxy is `book_datetime`.

**Question:** keep oldest-first within status (a queue), or switch to
newest-first (a feed)? Note that the schema constraint means we cannot sort by
when a booking was actually last acted on.

**DONE** — Vaughn chose newest-first. Both files now sort
`status_order ASC, book_datetime DESC, booking_id DESC` — the status grouping
panel asked to keep is untouched; only the tiebreaker flipped. `booking_id DESC`
is a second tiebreaker, not part of the decision: `book_datetime` is not unique,
and both queries page with `.range()`, so a non-unique sort could skip or
repeat rows across pages without it.

### PR-14 · Password visibility icon

> "Password visibility icon is incorrect." — Curativo

**DONE — 2 Sep 2026.** Vaughn: *"the login eye icon is the one that is correct
so follow that."*

The earlier writing of this entry was wrong twice, and the corrections are the
point. It described the codebase as using the **action** convention and counted
**six** toggles across three files. In fact there were **seven**, and they did
not agree with each other:

```
Login.jsx:292, ResetPassword.jsx:139,162,
SettingsPage.jsx:477,499,522        visible -> <Eye/>     (state convention)

PasswordConfirmModal.jsx:61         visible -> <EyeOff/>  (action convention)
```

So the icon genuinely *was* incorrect — not because either convention is wrong,
but because it **flipped depending on the screen**, and the odd one out was the
password prompt guarding destructive deletes. That is the screen a panelist is
most likely to reach, which is very probably what Curativo saw.

**Change:** `PasswordConfirmModal.jsx:61` now matches the other six —
`showPassword ? <Eye/> : <EyeOff/>`. All seven toggles are consistent, and the
convention is Login's: **an open eye means the password is currently visible.**
The `aria-label` and `title` already read "Hide password" / "Show password" and
were correct throughout; they are unchanged.

**Acceptance:** every password field in the app shows the same icon for the same
state, including the confirm-password modal.

### PR-16 · Deleting a booking that has a downpayment

> "Clarify why some bookings with an existing **down payment** can still be
> deleted." — Rivera

**DECIDED 2 Sep 2026 — deletion stays available, behind a password and a warning
that names the amount.** Vaughn chose this over blocking it outright.

The reasoning holds: a manager sometimes genuinely needs to remove a record, and
an absolute block just moves the problem outside the system. What was missing is
not the ability but the **informed** part of informed consent — the current
warning says "All associated payments, equipment, and vehicle assignments will
also be deleted" without saying how much money that is.

**BUILT — verified in the code 5 Sep 2026.** `formatPaymentDeletionWarning`
(`utils/payments.js:150`) is called from all four delete paths — `Bookings.jsx`,
`BookingDetails.jsx`, `ShortOrders.jsx`, `ShortOrderDetails.jsx` — and names the
amount: *"This will also delete 1 payment record, including ₱9,000 in verified
payments. That money will disappear from every report."* When nothing is
verified it says so instead of printing ₱0. Seen live on 4 Sep. The paragraph
below was the spec and is kept as the record of what was asked for.

**Change (as specified, now built):** in `Bookings.jsx` and `BookingDetails.jsx`, before
the existing confirm-and-password flow, compute the verified paid total with
`sumVerifiedPositivePayments`. When it is above zero, the confirm dialog must
name it — *"This booking has ₱25,000 in verified payments. Deleting it removes
those payment records permanently. Cancel it instead if you need to refund or
forfeit the downpayment."* Password re-verification stays as it is.

**Acceptance:** deleting a booking with verified payments states the peso amount
before asking for the password; deleting one with none is unchanged.

### PR-32 · Should a package sale count toward its menu items?

> "Clarify whether, for example, the sale of the **Bronze Package** should also
> contribute to the performance count of **Beef Caldereta**." — Rivera

**DECIDED 2 Sep 2026 — yes, a package sale counts toward its dishes.** Vaughn's
answer: the caldereta gets cooked either way, so it belongs in the picture of
what the kitchen actually produces.

This does **not** undo `blueprint-02-language.md` §4. That rule was about money
and ranking: a package and a tray are different units of sale and cannot share a
peso ranking. Counting production is a different question with a different unit.

**5 Sep 2026 — the decision stands, the build is deferred.** Vaughn's answer:
state the scope on the page now and build Dishes Prepared in the next increment.
Rivera's question was *clarify*, and a sentence on the panel answers it honestly
without opening a new code path on the Reports page days before a defence.

**Done instead (5 Sep):** the Menu Item Mix panel states that it covers
short-order trays only, that package dishes are not counted in it, and that they
are counted separately in a Dishes Prepared view planned for the next increment.

**Deferred change:** add a **Dishes Prepared** view to Menu Performance
that expands each package booking through `package_menu` and adds those dishes
to the ones ordered by name in short-order `menu_selections`. Measured in
**trays and portions only, never in pesos** — that is what keeps the revenue
tables honest while answering the kitchen's question. The existing Menu Item Mix
table stays exactly as it is, with its scope stated on the page.

**Acceptance:** a Bronze Package sale increments Beef Caldereta in Dishes
Prepared and does not change Menu Item Mix or any revenue figure.

---

## 3.5 The six items this file was missing — added 5 Sep 2026

Found by reading the minutes form against this file line by line. The form has
40 items; §1 tracked 34. Everything below is Förster's block on page 5 of the
form, which was never entered here. **Four of the six were already satisfied** —
they only ever looked open because nobody had written them down.

Each verdict below was checked against the code on 5 Sep 2026, not assumed.

### PR-35 · Simulate a booking for another month

> "Simulate **booking/reservation** for another month to see if it doesn't work,
> or whether it changes the dashboard info." — Förster

**OPEN, and it is a test rather than a change.** Förster is asking whether a
booking dated outside the current month behaves correctly and what it does to
the dashboard figures. Nothing in the code suggests it would not, but nobody
has run it.

What the answer should be, so the test has something to check against:

| Dashboard element | Anchored on | A booking next month should |
|---|---|---|
| Payments Received This Month | `pay_datetime` | not move it, unless a payment is recorded this month |
| Events in the next 7 days | `event_datetime` | not appear, unless the event is inside the window |
| Pending / status counters | booking rows | increment immediately |
| Calendar | `event_datetime`, Confirmed only | show a dot on that day once Confirmed |

**Acceptance:** create a booking for the following month, walk it to Confirmed,
and confirm each row above behaves as stated. Anything that disagrees is the
defect Förster was pointing at.

### PR-36 · "Quick Looks" grammar

> "Fix grammar of Quick Looks; change **"looks"** to **"look"**." — Förster

**DONE.** The heading no longer says either. `Bookings.jsx:1306` and
`ShortOrders.jsx:1251` render **"Quick filters"**, which is both grammatical and
more accurate — they are filters. The string "Quick Looks" survives only in JSX
comments (`Bookings.jsx:1282`, `ShortOrders.jsx:1227`), which never render.

Worth tidying those two comments so a reader does not think the old label is
still live, but nothing on screen is wrong.

### PR-37 · Date Filter — first date must be earlier than the second

> "**Date Filter** - The **first date** must be earlier than the **2nd date**
> (validation issue)." — Förster

**DONE, and in the strongest form available.** `Reports/DateRangeFilter.jsx:64`
sets `min={customStart || undefined}` on the end-date input, so the calendar
cannot offer a day before the start — an impossible range cannot be built rather
than being rejected after the fact.

It holds everywhere, because all eight pages with a custom range import that one
component: Bookings, Dashboard, Equipment, Payments, ShortOrders, Vehicles,
Reports/index and Reports/DetailModal. There is no second date-range widget to
drift from it.

### PR-38 · Only confirmed & completed bookings should count as revenue

> "Only **confirmed** & **completed** bookings should count as part of revenue —
> collectables/payables must not yet be included." — Förster

**DONE 5 Sep 2026 — applied literally, once the reason not to was removed.**

The first answer that day was to keep the card as cash received, on the grounds
that filtering by status would strand verified money on Approved bookings.
Vaughn's counter was better: fix the stranding instead of designing around it.
**Verifying a payment now opens the Confirm Event dialog immediately**, so a
booking stops sitting at Approved with money against it, and the panel's rule
becomes the right one rather than a lossy one.

### What the card counts

Verified payments anchored on `pay_datetime`, on **Confirmed and Completed
bookings only**. Nothing owed can reach it — an unpaid balance has no payment
row — and nothing on a booking still awaiting confirmation can either.

The two excluded figures are shown beneath it rather than dropped:

| September 2026 | |
|---|---|
| **Payments Received This Month** | **₱34,000** |
| plus awaiting confirmation | ₱15,000 |
| plus retained from cancellations | ₱19,500 |

A figure a manager cannot find is worse than one they disagree with, so nothing
vanishes. `REVENUE_BOOKING_STATUSES` in `utils/reportMetrics.js` is the single
definition.

### Applied on all three pages that show this number

Dashboard, Payments and the Reports Financial tab all read `revenueReceived`
from the same function, and all three show the same two sub-lines in the same
order. Changing only the Dashboard would have reproduced the defect logged in
`page-test-report-2026-09-04.md` §1.2, where one phrase meant two different
things on two pages.

Each card's drill-down lists `revenueRows` — exactly the rows the headline
summed — so a modal can never disagree with the card that opened it.

### The chain, and the three traps in it

`utils/confirmBooking.js` is new and holds the rule, the dialog copy and the
write. It exists because confirmation was already implemented three times and
the chain needed a fourth caller.

1. **The stale-payments race.** `payments` still holds pre-verification rows at
   the moment the chain fires — `fetchData()` has been called but has not
   returned — so recomputing the verified total would miss the payment just
   verified and refuse to confirm because of it. The verifier passes the new
   total in (`paidOverride`).
2. **The dialog is never skipped.** Confirming freezes equipment allocation and
   the existing dialog says so. A manager arriving from verification has had no
   other chance to be told, so the saving is the navigation, not the warning.
   The copy gains one leading sentence explaining why a dialog appeared on its
   own, and its cancel button reads *Not Yet* rather than *Cancel*.
3. **Silent when ineligible.** Below 50%, or on a booking that is not Approved,
   nothing appears. The prompt is offered, not requested.

It fires from all three places verified money is created: proof verification on
the two detail pages, proof verification on the Payments page, and a payment
recorded by hand.

**Still owed:** `Bookings.jsx` and `ShortOrders.jsx` each keep their own copy of
the confirm rule. They are unchanged and still correct; folding them into
`utils/confirmBooking.js` is a separate change with its own review.

### Verified

- `getPaymentsReceived` unit-tested against the real module: 11 checks including
  all three invariants and the exclusion of unverified rows.
- The live September rows run through the real module produce 34,000 / 15,000 /
  19,500, matching three independent SQL aggregations exactly.
- ESLint rule counts on all nine edited files are identical to `HEAD`. One
  regression was found and fixed on the way: calling the new helper from
  `handleSubmit` while it was declared further down the file made the React
  Compiler flag pre-existing `Date.now()`/`Math.random()` calls; bisecting
  isolated it to that one call site, and moving the declaration above its first
  caller cleared it.

### PR-39 · The filter on the dashboard didn't work

> "The **filter** on the dashboard didn't work." — Förster

**DONE.** Every dashboard stat card opens a modal with a working filter set:
search across customer name, booking reference and venue; a Package / Short
Order type filter; a payment-method filter on the revenue view; and the shared
date-range filter (`Dashboard.jsx:669-700`). The active-filter count is shown so
it is visible when one is applied.

The revenue view filters on `pay_datetime` and every other view on
`event_datetime` — the same anchor split as the cards themselves, so a filtered
list always sums to its card.

One known fault in this area is **not** this item and is recorded separately in
`page-test-report-2026-09-04.md` §1.1: the payments modal's own date filter can
only narrow a set already scoped to the current month, yet prints the wider
range as applied. That is a real defect and still open.

### PR-40 · There should be no duplicate names

> "Update that there should be no **Duplicate** Names." — Förster

**DECIDED 5 Sep 2026 — warn the manager, do not block.** Vaughn's answer.

The customer table is where the panel saw it. Checked 5 Sep against live data:

| Table | Duplicate names |
|---|---|
| `customer` | **2** — two accounts both "Customer User", different emails |
| `menu_item`, `equipment`, `package` | none |

Two real people can share a name, so refusing the second one is wrong: it would
reject a genuine namesake and the manager would have no way through. What the
manager actually needs is to be able to **tell them apart at the moment of
choosing**, which is the customer picker on the booking form.

**Change (owed):** where a customer is selected or displayed, detect other
customers sharing the same normalised `first_name + last_name` and disambiguate
the row — show the email or contact number beside the name, and mark it so the
manager can see there is more than one. Do not block the save.

**Acceptance:** with two customers named "Customer User", the picker shows both
with something that distinguishes them, and a booking can still be created for
either. With unique names nothing changes on screen.

**Not a schema change**, and not a mobile change — customers register from the
mobile app, but the fix is a web-side display rule, so it does not depend on
your groupmate.

---

## 4. Mobile app (separate repo)

### PR-08 · Proof of payment comes after approval

> "Let the proof of payment come after the customer submits a booking request for
> a specific date, and the Manager confirms their request." — Förster

The web side already enforces this: payments are disabled until the booking is
Approved. The mobile app must not ask for proof of payment during the initial
request. Workflow as specified by the panel is reproduced in PR-20 above.

### PR-11 · Event Type shows incorrect data on the review page

> "The Event Type displays incorrect data on the review booking details page when
> the customer reviews the booking." — Curativo

Mobile bug. Worth checking whether the mobile review screen reads `booking_type`
(Package / Short Order) where it means to read the package name or event
category — those are different fields.

### PR-12 · Customer cancellation must write Cancelled

> "The booking status should change to "cancelled" instead of "rejected" on the
> manager's side when a customer cancels a booking." — Curativo

The web side is already correct — `useCancellationHandlers.js:118` writes
`Cancelled`, `useRejectionHandlers.js:143` writes `Rejected`, and the two are
distinct actions. The mobile app must follow the same contract:

```
Customer cancels  → booking_status: 'Cancelled', status_order: STATUS_ORDER.Cancelled
Manager rejects   → booking_status: 'Rejected',  status_order: STATUS_ORDER.Rejected
```

**`status_order` is not maintained by the database.** Any write that sets
`booking_status` must set the matching `status_order` from
`src/utils/bookingStatus.js`, or the row stops sorting into its group on the web
list. This is the single most likely way the mobile app breaks the web UI.

---

## 5. Already closed — evidence for the panel

| ID | Comment | Closed by | Where to demonstrate |
|---|---|---|---|
| PR-02 | Filter payments by date range/month and method | earlier + `6f1997e` | Payments page: preset + custom date filter, Method filter (Cash/GCash/Bank Transfer). The summary card now follows the date filter. |
| PR-04 | Manager confirms payment after proof | pre-existing | Payments: `Awaiting Verification` card → Verify / Reject proof. |
| PR-05 | Total available equipment for a selected date | `a84deee` | Equipment → date picker → Availability tab: Usable / In use on this date / Available per item. |
| PR-06 | Availability keyed to the event date | `a84deee` + 21 Aug | Assign modal shows live availability for the booking's own date, and refuses a quantity that isn't free **on that date**. |
| PR-07 | Damaged stock must not count as available | `a84deee` | `getStockBreakdown` — `total = usable + out of service`, `available = usable − in use`. Flag an item damaged and watch Available fall. |
| PR-09 | No booking from past dates | pre-existing | `Bookings.jsx:754`, `ShortOrders.jsx:696`, plus the 3-day lead-time rule. |
| PR-13 | Block concurrent login | pre-existing | `manager.active_session_id`, `sql/manager_session_lock.sql`, `utils/managerSession.js`. |
| PR-17 | "Pending Balance" unclear | `73defff` | Now **Outstanding Balance** — "Unpaid balance on active bookings & orders". The old name collided with the booking status *Pending*. |
| PR-18 | "Net Collected" unclear | `73defff`, `0cf2415`, `6f1997e` | Now **Payments Received**, defined in `utils/reportMetrics.js` as cash in by `pay_datetime`, net of refunds. Retained cash from cancellations is reported on its own line rather than hidden inside a "net" figure — which is precisely the deduction the panel asked to see. |
| PR-24 | "Free to Use" → "Available" | `a84deee` | Equipment availability column and card. |
| PR-25 | Availability bar is wrong | `a84deee` | The bar now reads as share of **usable** stock committed. |
| PR-26 | Total ≠ available when assigning | `a84deee` + 21 Aug | Cause was `quantity_available` storing *usable* units while a column headed "Total stock" showed it. Both tabs now use Owned / Out of service / Usable and reconcile. |
| PR-28 | Vehicles "Free to Use" → "Available" | 21 Aug | `RESOURCE_STATE` in `utils/statusLabels.js`; `free` was removed as a separate term. |
| PR-29 | How Menu Performance is calculated | `76bc18a` | Every share is now share **of its own group's total** and sums to 100%. The old figure divided by the single biggest row, so the top row always read 100%. |
| PR-30 | Orders vs trays | `76bc18a` | Packages are measured in bookings, menu items in trays, in separate tables. Menu Item Mix shows share of trays **and** share of revenue side by side, because the most-ordered item and the highest-earning one are rarely the same. |
| PR-31 | Packages vs specific menu items | `76bc18a` | Split into Revenue by Product Line, Package Mix and Menu Item Mix. |

---

## 6. Suggested order

Updated 2 Sep 2026. All four open decisions are answered, so nothing here is
waiting on Vaughn any more. What is left is build work and one blocked item:

1. **PR-16 — the delete warning that names the money.** Smallest of the three,
   entirely local to two confirm dialogs, and it closes a real audit-trail
   risk. `sumVerifiedPositivePayments` already exists; the acceptance criteria
   are in §3.
2. **PR-32 — the Dishes Prepared view.** Larger, and the one to be careful
   with: it expands package bookings through `package_menu` and must stay in
   trays and portions, never pesos. Menu Item Mix does not change.
3. **The `return_log` + `booking_equipment.returned_quantity` migration.** The
   decision is settled (`blueprint-04-mobile-sync.md` §7); it unblocks
   UFR-OM-03 partial returns and needs Vaughn's groupmate, since the database
   is shared. Until it lands, build the return checklist all-or-nothing per
   item — **do not invent a workaround store**, because the workaround would
   outlive the gap.
4. **PR-27** — the only **OPEN** item, and it is **blocked, not pending**. It
   did not reproduce against live data on 22 Aug: BKG-067 has zero
   `booking_equipment` rows and its package has zero template rows, so there is
   nothing on that booking that could display a status, and the whole
   `booking_equipment` table has no row with `returned = true`. Fixing it blind
   would mean changing code to satisfy a symptom nobody can currently observe.
   **Ask the panel for the screenshot before touching it.**

Two questions remain open, and both are for PG's rather than for this repo: the
**fleet size** (the capstone's §1.1 says three cars and two motorcycles;
`FLEET_SIZING` assumes three) and whether the Operations Manager needs a
**dispatch status** beyond `Scheduled`/`Completed`. If they do, it joins the
migration in item 3 rather than becoming a second one.

Everything else in the summary table is DONE.

### Payments restructure (2026-08-23, not from the tracked panel review)

A later, untracked panelist note drove a further Payments rework beyond
what's in §2-5 above:
1. **Payments.jsx main table** now shows one row per booking/short order
   (grouped by `booking_id`) instead of one row per payment record; clicking
   a row opens the existing Payment Details modal, which lists every other
   payment on that booking.
2. **Edit and Delete are gone for payment records everywhere** — Payments.jsx,
   BookingDetails.jsx, ShortOrderDetails.jsx, and the shared
   `usePaymentHandlers.js` hook. A recorded payment already went through
   manual entry or mobile proof verification, so altering or removing it
   afterward doesn't make sense (this also closes PR-01 above). Booking-edit
   and equipment-edit locks (`isPaymentLedgerLocked`) are untouched — they
   never gated payments specifically, only the booking record and its
   equipment assignments.
3. **Refunds moved to their own tab** in Payments.jsx (Payments / Refunds),
   replacing the old "Transaction" dropdown filter — a refund is money going
   out, not a kind of payment, so it no longer shares a list with payments at
   all.
4. **`describePaymentKind` is now applied everywhere a payment history
   shows**, including BookingDetails.jsx and ShortOrderDetails.jsx (previously
   raw `pay_status`), so a payment's displayed kind is frozen at the moment it
   was recorded and never retroactively flips to "Fully Paid" when a later
   payment clears the balance (closes PR-03 above).

---

## 7. Found while reseeding — the `set_status_order` trigger

Not a panel item. Found on 5 Sep 2026 while seeding demo data, and it is the
cause of a defect this project has already written down twice and misdiagnosed
both times.

There is a trigger on `booking`:

```sql
CREATE TRIGGER set_status_order BEFORE INSERT OR UPDATE OF booking_status
  ON public.booking FOR EACH ROW EXECUTE FUNCTION update_status_order();
```

Its mapping predates the Confirmed status:

| | trigger | `utils/bookingStatus.js` |
|---|---|---|
| Pending | 1 | 1 |
| Approved | 2 | 2 |
| **Confirmed** | **5** (falls through `ELSE`) | **3** |
| **Completed** | **3** | **4** |
| **Cancelled** | **4** | **6** |
| Rejected | 5 | 5 |

Four of six disagree, and the trigger wins: it is `BEFORE INSERT`, so it
overwrites whatever the app supplies.

**This is exactly the symptom `bookingStatus.js` records.** That file said
*"three Confirmed bookings carried status_order 5 (Rejected's slot) and a
Cancelled one carried 4 (Completed's)"* and attributed it to old rows or to the
mobile app. Both were wrong — 5 and 4 are the trigger's values for those two
statuses. Seeding 13 fresh bookings through a direct SQL insert reproduced it on
all 13 at once, with no mobile app involved.

The file's other claim — *"It is NOT auto-maintained by the database"* — was the
opposite of the truth. Corrected in place on 5 Sep.

### Why it has not been more visible

The self-heal in `Bookings.jsx` repairs the drift on every list load, and it
works **only because its UPDATE touches `status_order` alone**. The trigger is
scoped to `UPDATE OF booking_status`, so it does not fire on that statement.
That is load-bearing and easy to break: folding the repair into a status change
would make it a no-op.

So the visible behaviour is: change a booking's status, and it sorts into the
wrong group until the list is reloaded.

### The fix

Replace the function body so it matches `STATUS_ORDER`:

```sql
CREATE OR REPLACE FUNCTION update_status_order() RETURNS trigger AS $$
BEGIN
  NEW.status_order := CASE NEW.booking_status
    WHEN 'Pending'   THEN 1
    WHEN 'Approved'  THEN 2
    WHEN 'Confirmed' THEN 3
    WHEN 'Completed' THEN 4
    WHEN 'Rejected'  THEN 5
    WHEN 'Cancelled' THEN 6
    ELSE 1
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

`ELSE 1` rather than 5: an unrecognised status should surface at the top of the
work queue, not be filed with the rejections.

**APPLIED 5 Sep 2026**, on Vaughn's instruction. The script, the verification
and the exact previous definition are in `sql/fix_status_order_trigger.sql`.
It replaces a function rather than altering a table, so it is not a schema
change in the sense `HANDOFF.md` forbids.

### Verified before and after

The defect was reproduced first, so the fix has something to be measured
against. Both runs were inside transactions that were rolled back.

| | Wrote | Trigger stored | |
|---|---|---|---|
| Before | `booking_status='Confirmed', status_order=3` | **5** | wrong |
| After | the same statement | **3** | correct |

Then every transition, and every insert:

- **UPDATE path** — Approved 2, Confirmed 3, Completed 4, Rejected 5,
  Cancelled 6. All correct.
- **INSERT path** — a fresh booking in each of the six statuses produced
  1 through 6 in order. All correct.
- **Live data** — 0 rows disagree with `STATUS_ORDER`. Counts unchanged at
  14 bookings, 15 payments, 17 equipment assignments, 16 vehicle assignments.

### It caught itself on the way in

Between the repair of the seeded rows and the trigger being replaced, **BKG-105
was cancelled through the web app**. `useCancellationHandlers.js` wrote
`status_order: 6` in the same statement as the status; the old trigger
overwrote it with 4, and the row turned up in the very next integrity check.

That is the whole defect, observed once more in the real application on a real
user action, minutes before the thing that causes it was removed. It was
repaired with the same status-order-only UPDATE the app's self-heal uses.

**Still true after the fix:** every write path must keep setting `status_order`,
and the self-heal must stay. The trigger now agrees with the app, but the app
cannot depend on a trigger the mobile repo does not know about, and a database
restored from an older backup brings the old function back with it.
