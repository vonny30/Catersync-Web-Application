# 1st Increment Minutes Form — row-by-row verification

**Checked:** 13 September 2026, against the working tree at
`C:\Users\Vaughn\Documents\React CaterSync ADMIN\frontend\src` and the live
Supabase project `qreuaphaxvfayxqqniqg`.

**Source document:** `CF3_MinutesForm_Group2_1stIncrement.docx` — oral defense
29 May 2026, CC11, Uytengsu Foundation Computer Science Building.
Panel: Asst. Prof. Janice Antoniette V. Förster, Asst. Prof. Maria Lourdes S.
Curativo (Chair), Asst. Prof. Albert Geroncio Y. Rivera. Content adviser:
Asst. Prof. Allan V. Credo.

**Method.** Every recommendation was re-checked against the *code as it stands
today*, not against the project's own tracker (`docs/panel-revisions-2026-05-29.md`).
Where the claim was about a number, it was confirmed with SQL against live data.
The tracker was treated as a claim to be tested, and it turned out to be wrong
in five places — three in the system's favour, two against.

**Headline:** 29 of the 34 rows are applied on the web system. Two are
genuinely open on this repo, three belong to the mobile app.

---

## 1. Verdicts

| ID | Module | Panel | Recommendation (as minuted) | Verdict | Evidence |
|---|---|---|---|---|---|
| PR-01 | Payments | Förster | Password verification before sensitive payment actions (deletion, approval) | **Applied** | Deletion no longer exists to gate — no delete/edit payment handler anywhere in `src`. Verification still gated: `Payments.jsx:966` `requestPasswordConfirm` |
| PR-02 | Payments | Förster | Filter by date range / month and by payment method | **Applied** | `Payments.jsx` Method = Cash / GCash / Bank Transfer only; `DateRangeFilter` with presets + custom range |
| PR-03 | Payments | Curativo | Distinguish down payment / partial / full, status follows amount paid | **Applied** | `utils/payments.js:116 describePaymentKind`, wired in Payments, BookingDetails, ShortOrderDetails |
| PR-04 | Payments | Curativo | Manager confirms the payment after proof is received | **Applied** | `handleVerifyConfirm` / `handleRejectProofConfirm`; "Awaiting Verification" card |
| PR-05 | Equipment | Förster | Total available equipment for a selected date | **Applied** | `getDailyEquipmentSnapshot(selectedDate)`, `Equipment.jsx:469` |
| PR-06 | Equipment | Förster | Availability keyed to the booking/event date | **Applied** | Assign modal reads availability for the booking's own date |
| PR-07 | Equipment | Förster | Damaged stock must not count as available | **Applied** | `getStockBreakdown`: `total = usable + outOfService`, `free = usable − committed`. Live DB: 3,598 owned vs 3,594 usable — the 4 out-of-service units are excluded |
| PR-08 | Booking Request | Förster | Proof of payment comes *after* the manager approves | **Applied (web) · open (mobile)** | Web gates payments on Approved. Mobile app must stop asking at request time |
| PR-09 | Booking | Curativo | No booking from a past date | **Applied (web) · open (mobile)** | `Bookings.jsx:813`, `ShortOrders.jsx:770` |
| PR-10 | Booking | Curativo | Order records by recency of processing | **Applied** | Both lists sort `status_order ASC, book_datetime DESC, booking_id DESC` |
| PR-11 | Booking | Curativo | Event Type shows wrong data on the review page | **Open — mobile repo** | Not reproducible on web; the review screen is mobile |
| PR-12 | Booking | Curativo | Customer cancel must read *Cancelled*, not *Rejected* | **Applied (web) · open (mobile)** | `useCancellationHandlers.js:140` writes `Cancelled`; `useRejectionHandlers.js:145` writes `Rejected` |
| PR-13 | Login | Förster | Block concurrent login from another device | **Applied** | `manager.active_session_id`, `utils/managerSession.js` |
| PR-14 | Login | Curativo | Password visibility icon is incorrect | **Applied** — *tracker is stale* | All six fields now read `showPassword ? <Eye/> : <EyeOff/>` — the state convention the panel expected. `Login.jsx:292`, `ResetPassword.jsx:139,162`, `SettingsPage.jsx:477,499,522` |
| PR-15 | Dashboard | Rivera | Clarify whether "Upcoming Event (7 Days)" includes today; find a better label | **Applied** | Reads **"Events in the next 7 days"** with the window spelled out (`upcomingWindowLabel()`), single constant `UPCOMING_WINDOW_DAYS` drives label *and* both queries |
| PR-16 | Bookings | Rivera | Clarify why bookings with a down payment can still be deleted | **Answered, not blocked** | Deletion still possible, but the confirm now states the payment count, the verified peso total, that it disappears from every report, and *"Cancel it instead if you need to refund or forfeit the downpayment."* (`Bookings.jsx:1123-1130`) |
| PR-17 | Payments | Rivera | "Pending Balance" is unclear | **Applied** | Renamed **Outstanding Balance**, "Unpaid balance on active bookings & orders" |
| PR-18 | Payments | Rivera | "Net Collected" is unclear | **Applied** | Renamed **Payments Received**; cash retained from cancellations shown on its own line instead of buried inside a "net" figure |
| PR-19 | Payments | Rivera | "Fully Paid" count does not match the number of records | **Applied — and re-fixed this month** | Root cause was two counts in *different units* under the same heading. Table header now prints both units: `N bookings · M payment records`; each status card prints `describeStatusCount` → "9 payments across 8 bookings". Both fetches page through `fetchAllRows`, so neither can truncate at 1,000 rows |
| PR-20 | Payments | Rivera | Clarify the payment workflow | **Applied** | Sequence documented in `docs/HANDOFF.md`; payments open at **Approved**, confirmation is the *consequence* of a verified payment |
| PR-21 | Payments | Rivera | Clarify the main purpose of editing payments | **Applied** | Editing was removed entirely — the ledger is append-only. Corrections are new entries, money back is a refund, a change to what is owed is the approval-time fee adjustment |
| PR-22 | Payments | Rivera | Why are some payments editable and others not? | **Applied** | Moot after PR-21; `paymentLockedMessage()` gives one wording everywhere a lock is shown |
| PR-23 | Payments | Rivera | **Refunds must not be classified as payments** | **Applied** | `Refund` removed from every Method dropdown; refunds have their own tab. Live DB: 2 refund rows, negative `amount_paid`, separate `pay_status` — they never enter Payments Received |
| PR-24 | Equipment | Rivera | "Free to Use" → "Available" | **Applied** | The string "free to use" no longer appears anywhere in `src` |
| PR-25 | Equipment | Rivera | Availability bar is wrong | **Applied** | Bar is share of **usable** stock committed; over-commitment shows "Short by N" rather than clamping to 100% |
| PR-26 | Equipment | Rivera | Total count ≠ available count when assigning | **Applied** | Both tabs use Owned / Damaged / Under Maintenance / Usable and reconcile |
| PR-27 | Equipment | Rivera | BK-067 shows *returned* but was never manually assigned | **Cannot verify — record no longer exists** | `BKG-067` is not in the `booking` table today. Every `returned = true` row in the database is backed by a real assignment, so the symptom cannot be reproduced. Defensive behaviour is in place: estimated lines are labelled "Estimated from package (not yet manually assigned)" and get no status badge and no Return control |
| PR-28 | Vehicles | Rivera | "Free to Use" → "Available" | **Applied** | `RESOURCE_STATE` in `utils/statusLabels.js` |
| PR-29 | Menu Performance | Rivera | Clarify how it is calculated | **Applied** | Every share is share of its own group's total and sums to 100%. Survived the September Reports rework intact |
| PR-30 | Menu Performance | Rivera | Orders vs trays as the unit | **Applied** | Packages counted in bookings, menu items in trays; "Trays Sold" and "Share of Trays" sit beside share of revenue |
| PR-31 | Menu Performance | Rivera | How packages vs specific menu items are treated | **Applied** | Split into Revenue by Product Line / Package Mix / Menu Item Mix |
| PR-32 | Menu Performance | Rivera | Should a Bronze Package sale count toward Beef Caldereta? | **Answered on the page** — *tracker is stale* | Menu Item Mix states it: dishes served inside a package are not counted there, because a package is sold per event and a tray is sold by the tray. A **Dishes Prepared** view that counts a dish from both sources is named as next-increment work |
| PR-33 | Equipment | Förster | What is the policy for equipment return — right after use? 12 hrs? 4 hrs? | **Applied for equipment · NOT carried to vehicles** | `RETURN_POLICY_TEXT`: due back within **24 h** of event start, returns recordable from **4 h** after. See §2.1 — the fleet still runs the old rule |
| PR-34 | Equipment | Adviser | "Does the total number of equipment really matter?" + see upcoming events with their packages and assigned equipment | **Applied** | Total stock demoted to Inventory as reference. Upcoming tab (default) lists each event in the horizon with its package, pax, venue, countdown and a per-item Required / Assigned / Status breakdown. Headline card now reads **Upcoming events** with an over-capacity warning |

**Tally:** 29 applied · 2 open on this repo (PR-27, PR-33-vehicles) · 3 mobile
(PR-08, PR-11, PR-12 — each already correct on the web side).

---

## 2. What is actually still open

### 2.1 The equipment return policy was never carried to vehicles — and the bug it fixed is still live there

This is the one substantive finding. PR-33 closed a real contradiction on the
Equipment page: overdue was computed from the event date, while the Return
button only unlocked four hours later, so for four hours an assignment was
flagged **OVERDUE in red, listed in the Overdue panel, with its own Return
button disabled** — the manager was told to act on something the system would
not let them act on. Equipment fixed it by anchoring overdue to a 24-hour due
time, which is always well after Return opens.

`Vehicles.jsx` still has both halves of the original defect:

| | Vehicles | Equipment |
|---|---|---|
| Return opens | `Vehicles.jsx:66` — event + `PICKUP_GRACE_HOURS` (4 h) | event + 4 h |
| Flagged overdue | `Vehicles.jsx:1333` — `eventDate < now` | event + 24 h |

So a vehicle assignment goes red at the moment the event starts and stays
un-returnable for four more hours. It also means the fleet has **no stated
return policy at all** — "Overdue" there just means the event date has passed,
which for a collection run that legitimately sets off hours later is not late.

If a panelist asks "and what's the return policy for vehicles?" at the 2nd
increment, the honest answer today is that there isn't one. This is a small,
contained change: import the same two constants and the same due-time rule.

### 2.2 PR-27 cannot be closed or dismissed — ask for the screenshot

`BKG-067` is no longer in the database, so the record the panel pointed at is
gone. Nothing in current data reproduces the symptom, and the defensive
behaviour the item asks for is already implemented. **Do not "fix" this blind.**
Ask Prof. Rivera for the screenshot, or state at the defense that the record
was removed during seeding and the guard is in place.

One related data oddity, found while checking: **BKG-124** has two
`booking_equipment` rows with `returned = true` but `returned_at = NULL`. The
app's own return handler always writes both (`Equipment.jsx:1197,1228`), so
that pair was written directly to the database, not through the system. The UI
does not break on it — it renders "Returned" with no date — but if you are
demonstrating the return history, that row will look odd. Worth cleaning up
before the defense.

### 2.3 Three mobile items, all correct on the web side

PR-08, PR-11 and PR-12 belong to the customer mobile app. The web contract is
already right for each, and PR-12 carries a trap worth repeating to whoever
writes the mobile code: **any write that sets `booking_status` must also set
the matching `status_order`** from `utils/bookingStatus.js`, or the row stops
sorting into its group on the web list.

---

## 3. The tracker is out of date — fix it before you hand it to anyone

`docs/panel-revisions-2026-05-29.md` still lists **PR-14, PR-16 and PR-32** as
needing a decision. All three have since been decided *in the code*:

| | Tracker says | Code actually does |
|---|---|---|
| PR-14 | "DECIDE — flip the icons or explain the convention?" | Already flipped, consistently, across all six password fields |
| PR-16 | "DECIDE — block deletion or warn harder?" | Warns harder, with the money named and "Cancel it instead" spelled out |
| PR-32 | "DECIDE — label it or build Dishes Prepared?" | Labelled on the page, with Dishes Prepared named as next-increment work |

It also lists PR-33 as fully done without carrying the "vehicles not changed"
caveat up into the summary table, and it still counts **4 open** when only
PR-27 and the vehicles gap remain.

A document that tells the panel you are still undecided about three things you
decided months ago is worse than no document. Bring it in line with §1 before
the 2nd increment.

---

## 4. What I could not check

The deployed build at `catersync-web-application.vercel.app` was not reachable
from this session, so every verdict above is against **source and live
database**, not the served bundle. If any of these changes are committed but
not yet pushed, the site will not show them. Confirm your working tree is
pushed before demonstrating.
