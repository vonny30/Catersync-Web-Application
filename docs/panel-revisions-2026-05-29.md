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
| PR-14 | Login | Curativo | Password visibility icon is incorrect | **DECIDE** |
| PR-15 | Dashboard | Rivera | "Upcoming Event (7 Days)" label is ambiguous | DONE |
| PR-16 | Bookings | Rivera | Bookings with a downpayment can still be deleted | **DECIDE** |
| PR-17 | Payments | Rivera | "Pending Balance" unclear | DONE |
| PR-18 | Payments | Rivera | "Net Collected" unclear | DONE |
| PR-19 | Payments | Rivera | "Fully Paid" count doesn't match the records | **OPEN** |
| PR-20 | Recording Payments | Rivera | Clarify the payment workflow | **OPEN** (docs) |
| PR-21 | Recording Payments | Rivera | Clarify the purpose of editing payments | **OPEN** (docs) |
| PR-22 | Recording Payments | Rivera | Why some payments are editable and others not | DONE |
| PR-23 | Recording Payments | Rivera | **Refunds must not be classified as payments** | DONE |
| PR-24 | Equipment | Rivera | "Free to Use" → "Available" | DONE |
| PR-25 | Equipment | Rivera | Availability bar is wrong | DONE |
| PR-26 | Equipment | Rivera | Total count ≠ available count when assigning | DONE |
| PR-27 | Equipment | Rivera | BK-067 shows returned but was never assigned | **OPEN** (investigate) |
| PR-28 | Vehicles | Rivera | "Free to Use" → "Available" | DONE |
| PR-29 | Menu Performance | Rivera | Clarify how it is calculated | DONE |
| PR-30 | Menu Performance | Rivera | Orders vs trays as units | DONE |
| PR-31 | Menu Performance | Rivera | How packages vs specific menu items are treated | DONE |
| PR-32 | Menu Performance | Rivera | Should a Bronze Package sale count toward Beef Caldereta? | **DECIDE** |

Counts: **21 done**, **4 open**, **3 need a decision**, **2 mobile**, 2 split.

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
**Change:** first reproduce with BK-067. Then ensure every estimated line renders
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

---

## 3. Needs a decision before coding

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

All six password fields use the same convention consistently
(`Login.jsx:225`, `ResetPassword.jsx:104,127`, `SettingsPage.jsx:457,479,502`):

```
hidden  → <Eye/>     (open eye — "click to reveal")
visible → <EyeOff/>  (slashed eye — "click to hide")
```

That is the **action** convention (the icon shows what the click does). The panel
appears to expect the **state** convention (the icon shows the current state:
hidden → slashed eye). Both are used widely; the code is at least internally
consistent.

**Question:** flip all six to the state convention, or keep the action convention
and explain it to the panel? Flipping is a six-line change.

### PR-16 · Deleting a booking that has a downpayment

> "Clarify why some bookings with an existing **down payment** can still be
> deleted." — Rivera

Current behaviour is deliberate but arguably wrong: `Bookings.jsx:1043-1051`
warns "All associated payments, equipment, and vehicle assignments will also be
deleted", asks for confirmation and a password, then deletes. So a booking with
real money recorded against it can be erased along with its financial history.

**Recommendation:** block it. A booking with any verified payment should not be
deletable at all — cancel it instead, which already records a refund or a
forfeited downpayment properly. Deleting destroys the audit trail the Reports
module depends on.

**Question:** block deletion outright when verified payments exist (recommended),
or keep it available with a stronger warning?

### PR-32 · Should a package sale count toward its menu items?

> "Clarify whether, for example, the sale of the **Bronze Package** should also
> contribute to the performance count of **Beef Caldereta**." — Rivera

The current rebuild (`76bc18a`) deliberately keeps them apart: **Menu Item Mix
counts only Short Order `menu_selections`**, so a Bronze Package sale does not
increment Beef Caldereta. The reasoning is in `blueprint-02-language.md` §4 — a
package and a tray are different units of sale and cannot share a ranking.

But the panel is asking a real operational question, and there is a defensible
second answer: for **kitchen volume** the caldereta gets cooked either way.

**Options:** (a) keep them separate and state the rule on the page —
"menu item figures cover short orders only"; (b) add a separate **Dishes
Prepared** view that counts a dish from both sources, using `package_menu` to
expand each package booking, measured in trays/portions and never in pesos —
which keeps the revenue tables honest while answering the kitchen question.

**Question:** (a) label the current behaviour, or (b) build the Dishes Prepared
view as well?

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

1. **PR-19** — the row cap. Silent, worsens on its own, and it is the likely
   cause of the count the panel could not reconcile.
2. **PR-27** — reproduce BK-067, then fix.
3. **PR-20/21** — write the payment workflow down (PR-22 done in `58eda4e`).
4. §3 decisions, once answered.

PR-15 (the 7-day label), PR-23 (refunds out of the method lists), PR-01
(password before sensitive payment actions — moot now that payments can't be
edited or deleted at all), and PR-03 (the partial-payment distinction) are
closed; PR-19 is the one left that is silently wrong rather than merely
unclear.

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
