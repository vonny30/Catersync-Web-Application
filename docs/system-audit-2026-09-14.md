# CaterSync — full system audit

**Date:** 14 September 2026
**Scope:** the entire admin web application — every `.js`/`.jsx` file under
`frontend/src` (82 files, ~1.5 MB), read in full, plus cross-checks against the
live Supabase project `qreuaphaxvfayxqqniqg`.
**Not in scope:** the customer mobile app (separate repository).

**Method.** Four independent deep reads covering bookings, money, resources and
auth/shared code, then every Critical and High finding re-verified by me against
the source before it was written down. Findings that did not survive
verification were dropped. Where a claim is about a number, it was checked
against live data.

**Result: 43 findings.** 4 Critical, 14 High, 15 Medium, 10 Low. Nothing found
is currently producing wrong data on screen *with today's records* — every
Critical is a trap waiting for a specific action or a specific data state, which
is precisely why they have survived. The live-data checks are in §6.

---

## 1. How to use this before the defense

Not all 43 matter equally to you this month. They sort into three groups:

| Group | What it means | Count |
|---|---|---|
| **A — fix before the defense** | A panelist could hit it live, or it touches a recommendation they already made | 9 |
| **B — security and data loss** | Not demo-visible, but you should not defend a system with these open | 4 |
| **C — everything else** | Real, worth fixing, not urgent | 30 |

Work A, then B. Group C is a backlog, not a blocker.

---

## 2. Group A — fix before the defense

### A1 · CRITICAL · Editing an Approved booking from the list silently erases the approval fee
`pages/Bookings.jsx:23`, `:122-148`, `:944`

At approval, `useApprovalHandlers` folds the additional fee and extra-pax cost
into `total_amount`. `Approved` is not payment-locked, so Edit stays live. The
effect at line 122 then unconditionally overwrites `total_amount` with a bare
package × pax recomputation, and line 944 writes that lower number back.

`utils/payments.js` exports `totalLossOnRecompute` **for exactly this** and it is
called in the three sibling files — `ShortOrders.jsx:574`,
`ShortOrderDetails.jsx:561`, `BookingDetails.jsx:602`. `Bookings.jsx` is the one
file of the four that does not import it. Verified: it imports only
`isPaymentLedgerLocked` and `formatPaymentDeletionWarning`.

**What a panelist sees.** Approve a ₱50,000 booking with a ₱8,000 fee → total
₱58,000. Customer pays ₱29,000 (50%). Open Edit from the *list* to fix a venue
typo, save. Total drops to ₱50,000. ₱8,000 of revenue is gone from every report
and the booking now reads 58% paid. The same click from the Details page is
correctly refused.

This is the single most damaging finding in the audit: it destroys money on a
routine action, and the guard that prevents it already exists and is already
used everywhere else.

### A2 · CRITICAL · "Kept from cancelled bookings" can render as "+ ₱-5,000"
`pages/Payments.jsx:1405-1407`

Guarded on `retainedFromCancellations !== 0`, then printed with a hardcoded `+`.
`utils/reportMetrics.js:127` defines it as `sum(cancelledRows)` — a net sum that
goes negative whenever a period contains a refund on a cancelled booking but not
the original payment. Dashboard (`:892`) and FinancialTab (`:68`) both guard the
same field with `> 0`; Payments is the only one using `!== 0`.

**Trigger:** a September cancellation refunds money taken in August. Under the
default This Month filter the card reads **"+ ₱-5,000 kept from cancelled
bookings."**

### A3 · CRITICAL · Two different definitions of "remaining balance" on the Payments page
`pages/Payments.jsx:657-665` vs `:776-806`

`getRemainingBalance` sums all non-unverified rows, so refunds *increase* the
balance. `handleSubmit` computes the same quantity with
`sumVerifiedPositivePayments`, which drops refunds. The first drives the
dropdown, the "Max: ₱X" hint and the Outstanding Balance card; the second
decides whether the payment is accepted.

**Trigger:** ₱10,000 booking, ₱10,000 paid, ₱3,000 refunded. Every hint says
₱3,000 is collectible. Submitting ₱3,000 is refused with *"This booking is fully
paid."* The money shown as collectible cannot be recorded, and the code comment
at `:652` explicitly promises these two agree.

### A4 · HIGH · The Awaiting Verification card surfaces work it then hides
`pages/Payments.jsx:1330` vs `:508-516`

`pendingVerificationCount` is computed over the raw payments array. The status
card beside it and the table below are computed over the date-filtered set. The
click handler only switches tab; it does not clear the date filter.

**Trigger:** three proofs submitted last month are still unreviewed. Under the
default This Month the red card says **3**, the status card directly below shows
**0** with a red badge reading **3** next to its own label, and the table is
empty. The unverified proofs — the entire reason this card exists — are
unreachable without knowing to change the date filter.

Panel relevance: Curativo's PR-04 ("manager confirms payment after proof
received") is demonstrated on this card.

### A5 · HIGH · Dashboard "Pending Bookings & Orders" count vs the list it opens
`pages/Dashboard.jsx:274` vs `:555-576`, `:664`, `:698`

The card counts every Pending booking with no date filter. The modal calls
`resetStatsFilters()`, which sets the preset to This Month, and then drops any
row whose event falls outside the current month.

**Trigger:** 9 pending requests, 7 for November events. Card reads **9**, modal
opens showing **2**. Pending requests are usually for future events, so this is
the normal case.

This is Rivera's PR-19 defect — a count that doesn't match its records — in a
module he didn't happen to look at. Reports solved it by passing the card's own
preset into the modal (`Reports/index.jsx:619`); Dashboard never got that fix.

### A6 · HIGH · "Events in the next 7 days" is truncated at the month boundary, with the filter hidden
`pages/Dashboard.jsx:582-610`, `:698`, `:1213`

Same invisible This Month predicate, but here the `DateRangeFilter` is
deliberately **not rendered** — the comment at `:1200` asserts these modals are
"already scoped by date" so no filter applies. The predicate at `:698` runs
anyway.

**Trigger:** on 28 September the window is 28 Sep – 4 Oct. Five events, three of
them in October. Card reads **5**, modal lists **2**, with no filter visible and
no way to clear it.

Panel relevance: this is the exact card Rivera asked you to relabel (PR-15). You
fixed the label; the number under it is wrong for the last three days of every
month.

### A7 · HIGH · Outstanding Balance means two different things on two pages
`pages/Payments.jsx:392-406` vs `pages/Reports/index.jsx:151`, `OverviewTab.jsx:67`

Both are event-anchored unpaid balances over the same period. Reports counts
every non-Rejected/Cancelled booking and now names the pending portion in its
sub-line. Payments fetches `.in('booking_status', ['Approved','Confirmed','Completed'])`
— silently excluding Pending — under a sub-line that claims no exclusion.

**Trigger:** with ₱150,000 of pending requests this month, Reports says one
number and Payments says another for the same question. `reportMetrics` has a
function for this figure and neither page calls it.

### A8 · HIGH · Vehicles flags OVERDUE ~7 hours before Return unlocks — and has no return policy
`pages/Vehicles.jsx:1333` (+ 7 more sites) vs `:66-70`

Already flagged in the minutes-form check; the deep read found it is not one
site but eight — the card, the group badge, the section-chip count, the Overdue
filter, the priority sort, the per-row chip, the "Overdue N days" text, and the
History tab.

Worse than first thought: the collection run is *scheduled* to leave at event +
4 h and runs 3 h, so a perfectly punctual collection is flagged Overdue in red
for about seven hours while doing exactly what it was planned to do.

Vehicles has no `RETURN_POLICY_TEXT` analogue at all. The only statement to the
user is the tab blurb at `:1639`, which publishes the broken rule as the policy.
`RETURN_DUE_AFTER_HOURS = 24` already exists in `utils/vehicle.js:404` and is
already imported into this module.

Panel relevance: Förster's PR-33 asked "what is the policy for equipment
return?" Equipment has an answer. If anyone asks the same about vehicles, there
isn't one.

### A9 · HIGH · The eye icon and its label use opposite conventions
`Login.jsx:288-292`, `ResetPassword.jsx:139,162`, `SettingsPage.jsx:477,499,522`, `PasswordConfirmModal.jsx:61`

The glyph follows the **state** convention (visible → open eye) — which is what
Curativo's PR-14 asked for, and I confirmed that as applied. But the
`aria-label` and `title` on the same button follow the **action** convention:
while the password is visible you see an open eye labelled "Hide password".

A sighted user and a screen-reader user are given opposite models of the same
control. One fix, six places. Small, but it is literally the panel item, and
hovering the button during a demo shows the contradiction.

---

## 3. Group B — security and silent data loss

### B1 · CRITICAL · Authentication fails OPEN
`contexts/AuthContext.jsx:292-308`

After two retries, the `catch` in `checkManagerImpl` ends:

```js
setUser(authUser);
setIsManager(true);
return true;
```

Any failure of the `manager` lookup that is not "Session expired" — an RLS
denial, a 500, a DNS blip, an offline moment — grants full manager access. The
`!manager` deny path at `:213` is only reached when the query *succeeds*.

Two consequences. A **customer** account from the shared mobile project that
signs in on the admin page during a transient error gets into the console. And
this path never reaches the session-lock code, so the single-device lock (PR-13)
is bypassed. `ProtectedRoute` only reads `isManager`, so it lets it through.

The intent is obvious and sympathetic — don't lock a manager out over a network
blip. But the failure direction is backwards: on an unresolvable error it should
show "can't verify your account, retry" and grant nothing.

### B2 · CRITICAL · Every walk-in customer is created with the same hardcoded password
`utils/createWalkInCustomer.jsx:97`, `:155`

```js
const defaultPassword = 'Password123!';
```

Used for every walk-in `signUp`, and displayed in a success toast. There is a
comment defending it (staff can tell the customer on the spot), and the
convenience argument is real — but anyone who learns one walk-in customer's
email owns their mobile account, and the pattern is guessable from a single
counter interaction. There is no forced reset on first login.

This is the finding most likely to be asked about directly. Förster's PR-01 was
about payment security; a panelist who pulls that thread reaches this.

Minimum fix: generate a random password per customer and force a change on first
login. If counter usability matters, show the generated password once in the
toast — that preserves the workflow and removes the shared secret.

### B3 · CRITICAL · Package and menu-item deletes destroy child rows, then report success without checking
`pages/PackagesAndMenus/index.jsx:783-786`, `:831`

```js
await supabase.from('package_category').delete().eq('package_id', id);
await supabase.from('package_equipment').delete().eq('package_id', id);
await supabase.from('package_menu').delete().eq('package_id', id);
await supabase.from('package').delete().eq('package_id', id);
toast.success('Package deleted.');
```

None of the four results is inspected — in a file that uses
`if (error) throw error` everywhere else. If the final delete fails on an FK the
booking-count guard didn't cover, or on an RLS policy, the package **survives
with its categories, equipment and menu links already wiped**, and the manager
is told it was deleted. `fetchData()` then re-renders it as an empty, unbookable
package.

Worth saying: the guards *before* these lines are genuinely good — the
booking-count check, the "last available item in a category included in N
packages" check, and `checkMenuItemUsedInBookings` using `fetchAllRows`. The
protection is well thought out right up to the moment of writing.

### B4 · HIGH · The password reset page can be used to change a password without knowing it
`pages/ResetPassword.jsx:22-30`, `:49-58`

The "valid token" gate is `!!searchParams.get('token')` — any value passes, and
the token is never verified or used. Path 3 accepts **any existing session** as
proof of recovery, not specifically a recovery session.

So a signed-in manager, or anyone at an unlocked workstation, can navigate to
`/reset-password`, type a new password, and `updateUser` changes it using the
live session — no current password required. `SettingsPage.jsx:227` correctly
calls `verifyPassword` first; this page doesn't. The owner is then locked out of
their own account.

The code comment explains why path 3 exists (your email template sends a 6-digit
code, and without it the flow had no ending), so this is a real tradeoff rather
than carelessness. The fix is to distinguish a recovery session from an ordinary
one rather than to remove the path.

---

## 4. Group C — the rest, by theme

### Count-vs-list mismatches (the recurring defect class — 6 more)

| | Where | What diverges |
|---|---|---|
| C1 | `Bookings.jsx:1276` / `ShortOrders.jsx:1220` | "Upcoming Confirmed" badge counts from **now**; the filter it applies starts at **local midnight**. At 3 PM with two events already run today, badge says 3, list shows 5 |
| C2 | `Bookings.jsx:1275` / `ShortOrders.jsx:1219` | "Today's Events" badge counts within the *active* date filter; clicking **replaces** that filter. With "Date Created / This Month" set, badge 1 → list 4 |
| C3 | `Equipment.jsx:1703` / `Vehicles.jsx:1345` | Section-chip counts (Overdue/Today/Upcoming) ignore the date preset the list applies. Chip reads "Overdue (2)", list says "no trips match". The *cards* reset the preset before navigating; the chips were never given the same treatment |
| C4 | `Vehicles.jsx:1078` vs `:1658` | "Trips today" excludes only Rejected/Cancelled; the Day schedule below excludes Completed too. An event that auto-completes during the day drops out of one and not the other |
| C5 | `Payments.jsx:508-516` | "All Payments" and "Downpayment" card amounts include Pending Verification **and Proof Rejected** money, directly below a card that excludes it |
| C6 | `Reports/index.jsx:207` | `_collectedBreakdown` only includes bookings with `paid > 0`; the card sums every booking's net paid, so an over-refunded booking is in the total and absent from the list |

### Silent failures — a failed read or write reported as success (7)

- **`BookingDetails.jsx:185`, `:203`, `ShortOrderDetails.jsx:182`** — `error` is
  not destructured at all on the equipment and dispatch reads. An RLS denial or
  dropped connection yields `data === null` → empty array → the page renders
  "No equipment allocated" and "This event still needs transport arranged" for a
  Confirmed wedding that has 109 units and three vans booked. Nothing is logged;
  the outer try/catch never fires because supabase-js resolves rather than
  throws. **This is the most dangerous of the silent failures** — it doesn't
  show a wrong number, it shows a confident absence, and a manager acting on it
  double-assigns.
- `utils/autoComplete.js:78-81` — a failed equipment/vehicle release after
  auto-completion is swallowed. The booking completes with stock still marked
  out. The cancellation and rejection paths surface a toast per failed release;
  this path is the outlier.
- `utils/createWalkInCustomer.jsx:46-50`, `:61-67` — duplicate checks ignore
  `{ error }`, so a failed check falls through and creates a duplicate.
- `SettingsPage.jsx:180-187` — `manager.email` is written before the new address
  is confirmed, and a failure is only `console.warn`'d, so `manager.email` and
  `auth.users.email` diverge silently.
- `useRejectionHandlers.js:204`, `BookingDetails.jsx:505`,
  `ShortOrderDetails.jsx:473` — the `[REFUND]` audit note append is unchecked; a
  failure loses the audit line while the toast says "Refund recorded".
- `Bookings.jsx:875`, `ShortOrders.jsx:831` — duplicate-booking guard is skipped
  on error with only a `console.error`.
- `Bookings.jsx:1149`, `:1200`, `ShortOrders.jsx:1085`, `:1130` — cascade deletes
  awaited with the result discarded; only the parent failure is reported.

### Resource correctness (5)

- **`utils/equipment.jsx:203-264`** — `revalidateAssignmentCapacity`, documented
  as re-running "the identical rule against current data", actually applies a
  *weaker* rule: it sums only real `booking_equipment` rows, while its three
  siblings also add estimated package-template demand. The last check before the
  INSERT is the most permissive check on the page. It only fails to bite because
  the front-line check happens to be stricter.
- **`utils/equipment.jsx:673-757`** — the stock-reduction impact check groups by
  **UTC** date while every other equipment grouping uses local midnight. In
  UTC+8 any event before 08:00 falls into the previous UTC day, so two same-day
  events split into two buckets and a reduction that should be blocked goes
  through with a success toast.
- **Completed bookings hold resources inconsistently.** Equipment counts a
  Completed-but-unreturned booking as a live commitment (deliberately), but every
  availability query filters to Approved/Confirmed — so the same units read as
  free in the Assign modal and can be promised twice. Vehicles has the mirror
  asymmetry: `findConflictingAssignment` blocks the van, while the approval
  planner treats it as free. Approval and manual assignment give opposite
  answers about the same vehicle.
- `Equipment.jsx:3203` — the Availability detail modal labels usable stock as
  "total": an item with 20 owned / 5 damaged opens as "15 of 15 total". This is
  verbatim the bug `getStockBreakdown` says was fixed everywhere; this modal is
  the only place still reading `quantity_available` raw.
- `ApprovalAvailabilityCheck.jsx:380` vs `:574` — the fleet pill never reacts to
  the checkboxes below it. Untick two of three vans and the card reads "3 of 5
  ready" above "1 vehicle will be dispatched".

### Session and auth robustness (4)

- `utils/managerSession.js:82-117` — the claim never compares the held session id
  against this browser's own. Signing in again from the same browser is rejected
  as "another device", and AuthContext then local-signs-out, **killing the
  working tab too**. This is the exact cross-tab failure the file's header
  comment says was fixed.
- `AuthContext.jsx:41-44`, `:413-420` — `freshLoginAttemptRef` is never reset on a
  *failed* login, leaving the tab permanently armed; the next cross-tab
  `SIGNED_IN` is treated as fresh and kills both tabs.
- `ForgotPassword.jsx:77` × `AuthContext.jsx:255` — password reset is unusable
  while signed in on another device. `verifyOtp` creates a session, the lock is
  held elsewhere, and this browser is signed out mid-reset. Non-deterministic:
  when the race goes the other way the recovery session steals the lock and
  kicks the office PC out instead.
- `managerSession.js:61-62` — a 30-second staleness window against browsers that
  throttle background tabs to once a minute. Leave the console in a background
  tab for a minute and your own claim is classified as abandoned.

### Validation and input (4)

- `pages/Login.jsx:89` — the password is `.trim()`ed on sign-in but sent raw by
  `ResetPassword.jsx:78` and `SettingsPage.jsx:236`. Set a password with a
  trailing space and you can never log in again.
- `components/CustomerSearch.jsx:77-82` — unescaped user input interpolated into
  a PostgREST `.or()` filter. Typing a comma ("dela cruz, juan") splits the
  expression and 400s the request; `%` and `_` are also unescaped.
- `PackagesAndMenus/index.jsx:288`, `:303`, `:318` — duplicate-name checks use
  `ilike` with unescaped wildcards, so "Buffet_1" collides with "Buffet 1" and a
  package named "Combo%" blocks every name starting with "Combo". *(The checks
  themselves do exist and do work — Förster's no-duplicate-names recommendation
  is satisfied.)*
- `Bookings.jsx:2357` / `ShortOrders.jsx:2239` — the rejection modal labels the
  reason "Optional, but recommended"; `useRejectionHandlers.js:83` hard-requires
  it. Both Details pages say "required" correctly; the two list pages are stale
  copies.

### Usability and layout (7)

- **The 3-day lead-time rule is a creation rule enforced on every edit.**
  Verified in all four save paths (`Bookings.jsx:817`, `ShortOrders.jsx:774`,
  `BookingDetails.jsx:781`, `ShortOrderDetails.jsx:684`): the check runs whenever
  `event_datetime` is present, not when it has changed. An Approved booking for
  the day after tomorrow cannot have its venue typo corrected through any screen
  in the app — the error names a rule about *making* a booking.
- `Bookings.jsx:1670` vs `:1518` — the "Balance Remaining" pill exists in the
  table layout but not the card layout, and the card layout is what renders below
  1280px. A Completed booking with money owed looks settled on every laptop.
- `BookingDetails.jsx:1844` — the dispatch header has no mixed branch: one van
  returned and one still out reads "all assigned". The Equipment card six lines
  away handles this correctly ("2 of 3 returned").
- `BookingDetails.jsx:2508` — cancelling within 3 days offers no refund fields,
  so the recoverable excess above the forfeited downpayment can't be returned at
  the moment of cancelling. `useCancellationHandlers.js:56` supports this case
  and has copy written for it; the modal gates the whole block on `isRefundable`.
- **~14 modals cannot scroll.** `Equipment.jsx:3260/3387/3452`,
  `Vehicles.jsx:2527/2582/2634`, `Bookings.jsx:2340`, `ShortOrders.jsx:2222`,
  `BookingDetails.jsx:2223/2458/2616`, `ConfirmModal`, `ErrorModal`,
  `PasswordConfirmModal`, `Reports/SimpleDetailModal.jsx:22`. All are
  `overflow-hidden` with no `max-h-[90vh] flex flex-col` + inner
  `overflow-y-auto` — the pattern the Assign and Edit modals get right. Add
  Equipment is the worst case: on a 768px laptop the Save row is clipped with no
  way to reach it, and `ConfirmModal` handles neither Escape nor a backdrop
  click, so there is no way out at all.
- **`components/Select.jsx` has no keyboard support** — in the component that
  replaced every native `<select>` app-wide. No `role="combobox"`, no arrow keys,
  no typeahead, and because the panel is portalled to `document.body`, Tab from
  an open trigger jumps to the end of the document. A keyboard-only user can open
  any dropdown and cannot choose anything. *(The original "panel far wider than
  its trigger" bug is genuinely fixed.)*
- `ManagerLayout.jsx:239` — the profile menu trigger is a `<div onClick>` with no
  role or key handler, so Sign Out is keyboard-unreachable from the header.

### Pagination — latent, not yet live (4)

PostgREST caps responses at 1000 rows with no error. You have 21 customers and
well under 1000 of everything else, so **none of this is biting today** — but the
failure direction matters: an under-count of committed stock *overstates* what
is free.

- `Dashboard.jsx:208-264`, `:557-570` — unpaginated, and the card and its modal
  truncate *differently* (card is two queries at ≤1000 each, modal is one at
  ≤1000), so past the cap they disagree by construction.
- `utils/equipment.jsx:548`, `:580`, `:678`, `:707`, `:235` — the inventory read
  is paged with a comment about truncation; the `booking_equipment` reads beneath
  it are not. The rule is applied to only half the subtraction.
- `BookingDetails.jsx:223`, `ShortOrderDetails.jsx:202` — the customer dropdown
  is unpaginated where both list pages use `fetchAllRows`. Past 1000 customers a
  booking's Edit modal shows no matching option, the field is `required`, so the
  manager must pick someone — and that writes a different `customer_id`.
- `BookingDetails.jsx:980`, `:1103` — unbounded `booking_equipment` reads in the
  stock check.

### Cosmetic (5)

- Pills missing `inline-block whitespace-nowrap` — `Payments.jsx:2278/2280/2332/2334`,
  `Dashboard.jsx:1105/1271`, `SimpleDetailModal.jsx:28`, `Equipment.jsx:2142/2258`.
  Same defect you just fixed in `DetailModal.jsx`; these are the call sites that
  weren't in that sweep.
- `ConfirmModal.jsx:54` — every confirmation message in the app renders in
  `font-mono`. Almost certainly unintended.
- `ItemFormModal.jsx:190/206/423` — number inputs have no `min`/`step`; negatives
  are correctly rejected on submit, so this is inline-feedback only.
- `PackageCard.jsx:94/106` — `key={index}` on pill lists; no user-visible bug
  today since the arrays are rebuilt wholesale.
- `index.css:96` — a global `select { background-color: transparent !important }`.

---

## 5. One thing to settle, not fix

`utils/bookingStatus.js:21-44` carries a dated correction (5 Sep 2026) stating
that `status_order` **is** maintained by a database trigger, and that the trigger
is wrong — it overwrites whatever the app supplies. Every `booking_status` write
in the app also sets `status_order`, which under that model is cosmetic, and the
self-heal at `Bookings.jsx:240-248` becomes the load-bearing code.

Two models of the same column, disagreeing about which code is doing the work.
Settle it before the defense — it is the kind of thing an adviser asks to see,
and the file names the real fix (correct the trigger function).

Separately: the booking/order INSERT at `Bookings.jsx:945` and
`ShortOrders.jsx:882` is the one `booking_status` write that omits
`status_order`. Harmless today because Pending maps to 1 in both places, but it
is the single gap in an otherwise complete set.

---

## 6. What the live data says

Checked against the production database today. **No Critical finding is
currently manifesting** — each needs a specific action or data state:

| Check | Result |
|---|---|
| Completed bookings holding unreturned equipment | 0 rows, 0 units |
| Completed bookings with open vehicle assignments | 0 |
| Unverified payments (which A4 would hide) | 0 |
| Customers (pagination threshold is 1000) | 21 |
| Pending bookings with events outside this month | 0 today |

That is good news and bad news. Good: nothing is wrong on screen right now, so a
demo will look clean. Bad: it means these have all survived precisely because
the data hasn't happened to trigger them, not because anything is stopping them.
A4, A5 and A6 all fire the moment a record lands outside the current month —
which is one late-September booking away.

---

## 7. What was checked and found correct

Worth knowing, because these are the things a panelist is most likely to probe,
and they hold up:

- **PostgREST embed trap** — clean across all four booking pages and five hooks.
  Every aliased embed that also needs the scalar either selects `*` or names the
  scalar at top level.
- **Timezone handling** — `utils/datetimeLocal.js` is correct in both directions
  and used at every edit-form load point. Both quick filters correctly avoid
  `toISOString()`, with a comment explaining the Manila-before-8AM bug it fixes.
  The one UTC slip is the equipment impact check above.
- **Confirm-eligibility / 50% rule** — the list-page copies are arithmetically
  identical to `utils/confirmBooking.js`.
- **Short-order daily cap** — consistent across all three surfaces (create hint,
  approval panel, hard block), all counting the same way and triggering at 4.
- **`verifyPassword.js`** — the throw-vs-false distinction is right and both
  callers handle the throw. A thrown error cannot read as "verified".
- **Password-confirm modal** — not bypassable; `close(true)` is reachable only
  after verification returns true.
- **Cancelled/Rejected bookings** do release equipment and vehicles, with a
  per-write error toast.
- **Estimated package lines** correctly show no assignment status and no Return
  control — the PR-27 acceptance condition.
- **Delete guards for live references** are real, paged, and better than they
  needed to be (the "last item in a category included in N packages" check is a
  genuinely good catch).
- **`useRealtimeRefresh.js`** — no leak; ref, serialisation, debounce clear and
  `removeChannel` all correct.
- **Reports' use of `fetchAllRows`** with chained primary-key ordering is
  complete and correct.
- **`Select.jsx` width** — the original overflow bug is genuinely fixed.

---

## 8. Suggested order

1. **A1** — it destroys money and the fix is one import plus one guard already
   written.
2. **B1, B2, B3, B4** — you should not defend a system with auth failing open and
   a shared customer password.
3. **A4, A5, A6, A7** — four count/list mismatches in the modules the panel
   already commented on.
4. **A2, A3** — wrong money on the Payments page.
5. **A8, A9** — both are panel items with your name on them.
6. Group C, starting with the silent read failures in `BookingDetails.jsx`.

I can write Claude Code prompts for any of these. I'd suggest taking them in
batches by theme rather than all at once — the count/list mismatches share a fix
pattern and are worth doing together, and the silent-failure group is a
mechanical sweep.
