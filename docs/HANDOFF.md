# CaterSync Admin — working context

Read this first, then the two blueprints beside it. They are the agreed plan for
this codebase; treat their decisions as settled unless Vaughn says otherwise.

- `blueprint-01-reporting.md` — turning Reports from a metrics dashboard into
  business reporting. Money model, defect list, report catalogue, build order.
- `blueprint-02-language.md` — the UI vocabulary standard and the corrected
  report percentage maths. Screen-by-screen rewrite table.
- `panel-revisions-2026-05-29.md` — **every comment from the 1st Increment oral
  defense**, mapped to files and status. Read this before starting new work: it
  is the list the project is actually graded against. 13 of its 32 items are
  already closed; §2 is the open queue, §3 needs Vaughn's answer first.

Drafted 21 Aug 2026. Line references are against the tree as it stood that day.

---

## Hard constraints

- **No schema changes.** Everything must be derived read-only from the existing
  Supabase tables. Vaughn chose this explicitly. Any proposal needing a new
  table or column is out of bounds until he lifts it.
- **Audience is the owner/manager making decisions** — not accountants, kitchen
  ops, or a thesis panel. Management reporting, not invoices or job orders.

## Settled vocabulary decisions

| Question | Decided |
|---|---|
| The logged-in person is called | **Manager** (not Owner, not Admin) |
| Deposit term | **Downpayment**, one word — matches the stored `pay_status` |
| Umbrella for both products | **Bookings & Orders** — never "Orders" alone, it collides with Short Orders |
| Casing | **Sentence case**, except proper nouns, stored status values, and column headers |

## Status

**Done and committed (21 Aug 2026)**

- Blueprint 02 §9 **step 1**, the Menu Performance rebuild. Changed
  `src/pages/Reports/`: `index.jsx`, `MenuPerformanceTab.jsx`, `OverviewTab.jsx`,
  `helpers.js`. See `blueprint-02-language.md` §4.
- Blueprint 02 §9 **step 2**, the misleading labels. Changed `Payments.jsx`
  (Pending Balance → Outstanding Balance, Net Collected → Payments Received),
  `Equipment.jsx` (Almost full → Low stock, Overbooked! → Short by {n}, None
  left → Fully committed, Used today → In use on this date), `Dashboard.jsx`
  (Net Collected This Month → Payments Received This Month), and
  `Reports/BookingSummaryTab.jsx` (Accounting Month → Event Month, Gross
  Revenue → Revenue Earned). Card labels, modal titles, table footers and the
  matching code comments were all updated together.

- Blueprint 02 §9 **step 3**, the glossary sweep. 64 replacements across 11
  files: `Login.jsx`, `ManagerLayout.jsx`, `Dashboard.jsx`, `Bookings.jsx`,
  `ShortOrders.jsx`, `BookingDetails.jsx`, `ShortOrderDetails.jsx`,
  `Payments.jsx`, `Equipment.jsx`, `Vehicles.jsx`, `Reports/DetailModal.jsx`.
  Catersync → CaterSync, Owner → Manager, Client → Customer, Ref/Booking
  Ref/Order Ref → Reference, Down payment → Downpayment, Full Payment → Fully
  Paid (label only), Needs Review → Awaiting Verification, in repair → under
  maintenance, Pax/Unit → Guests per Unit, Quick looks → Quick filters,
  headcount → guests.

- Blueprint 02 §9 **step 4**, the status vocabulary. Added
  `src/utils/statusLabels.js` and removed the duplicated lifecycle function from
  `Equipment.jsx` and `Vehicles.jsx` (8 call sites now share one
  implementation). Vehicles display Assigned → In Use → **Returned** instead of
  Scheduled → In Use → **Completed**, which stops one word meaning both "the van
  came back" and "the wedding happened". Availability labels moved to
  `RESOURCE_STATE`: Deployed → Committed, Maintenance → Under Maintenance.

- Blueprint 02 §9 **step 5**, the messages. 51 targeted rewrites plus 3 shared
  error rewrites across 19 files — including the shared hooks and
  `AuthContext.jsx`, where many of the most-seen toasts actually live. No
  `toast.success` anywhere now contains "successfully" or an exclamation mark.
  "Logged out" became "signed out" to match the Sign in / Sign out verbs, and
  `'Order deleted.'` became `'Short order deleted.'` per the umbrella rule.
  Login's `'Welcome back!'` toast was removed outright — the page it lands on
  already says it.

- **Blueprint 01 §2 — one definition of money.** Added
  `src/utils/reportMetrics.js` and repointed Dashboard, Payments and Reports at
  it. `getPaymentsReceived()` is cash-basis (anchored on `pay_datetime`) and
  returns a **split**, not one number: `paymentsReceived` (active bookings) and
  `retainedFromCancellations` (a forfeited downpayment is real money but is not
  live business), which always sum to `totalCashIn`.
  `getEventPeriodTotals()` owns the event-anchored trio, where
  `contractValue − paidAgainstEvents = outstandingBalance`.
  - Dashboard's card is now the shared function; retained cash shows on its own
    line, and its drill-down lists exactly the rows the card counted.
  - The Payments card follows the page's date filter. Outstanding Balance and
    Paid in Full deliberately do **not** — they are positions as at now, not
    flows over a period.
  - Reports' Financial tab shows the cash figure as a headline and keeps the
    event-anchored trio beneath it, relabelled Contract Value / Paid So Far /
    Outstanding Balance so the three visibly reconcile.
  - The monthly chart is now built from the same rows as the card, so the bars
    add up to the headline. It previously skipped negative amounts while its
    caption claimed to be net of refunds (Blueprint 01 defect 5), and filtered
    on event-in-range while being a payment-date chart.

- **PR-15, the 7-day window** (23 Aug 2026). `Dashboard.jsx`,
  `Reports/DateRangeFilter.jsx`, `Reports/helpers.js`. The Dashboard card and
  its modal now name both ends of the window with real dates, and every date
  range in the system is trapped against inversion. See the two entries under
  *Conventions worth preserving*.

**Next up** — the panel queue in `panel-revisions-2026-05-29.md` §6, starting
with **PR-19** (uncapped queries in `Payments.jsx`, the likely cause of the
"Fully Paid count doesn't match" comment). Blueprint 02 §9 step 6 — the
remaining screen-by-screen items in §6 — can be picked up in any order
alongside it.

**Deliberately not touched yet** — `FinancialTab.jsx:53` still reads "Monthly
Revenue (Net Collected)". Renaming it would be premature: that chart is
currently *gross*, because negative amounts are skipped when the series is
built (Blueprint 01 defect 5). Fix the maths first, then the label.

**Not started** — everything in Blueprint 01. Its Phase 0 defect 1 (unbounded
report queries hitting the PostgREST 1000-row cap) is the most urgent single
item in either document; it fails silently and gets worse on its own.

## Equipment page — audited 21 Aug 2026

The stock identity (`total = usable + out of service`, `available = usable −
in use`) is owned by `getStockBreakdown` in `utils/equipment.jsx` and is now
printed on the page so a manager can check it by eye.

Guardrails, and where each is enforced:

| Guardrail | Where | Note |
|---|---|---|
| Returns open 3 h after the event starts | `getReturnAvailability`, both return handlers + the Lock icon on the buttons | One sentence, used in all four places |
| Assign: enough free **on the event's date** | `addToQueue` (queue time) and `handleAssignSubmit` (submit time) | Queue-time check now reads the date snapshot, not total stock |
| Assign: no duplicate item per booking | `addToQueue` | |
| Reducing usable stock can't strand a booking | `checkEquipmentAvailabilityImpact`, from both Edit and Flag issue | |
| Delete blocked by active assignments, history, or package templates | `handleDeleteEquipment` | **All three checks run before the confirm and password**, not after |

Deliberately removed: the Needs Attention modal. It duplicated the Inventory
tab without the Flag issue / Edit buttons. The sidebar's "View all" now opens
the Inventory tab filtered to items needing attention, with a clearable chip.

The Availability tab shows Usable / In use on this date / Available. Owned and
out-of-service moved off the row — out of service appears as a red sub-line
under the item name only when it is non-zero, which is what explains a reduced
usable figure.

## Things that will bite you

- ~~`Reports/index.jsx` fetches ten tables with no `.range()`/`.limit()`.~~
  **Fixed** — `fetchAll()` pages with a stable `.order()` on each primary key.
- ~~Dashboard and Reports compute "collected" differently.~~ **Fixed** — all
  three pages now import `utils/reportMetrics.js`. Anything new that reports
  money must use it too rather than summing payments inline; that inline sum is
  how three different answers appeared in the first place.
- **`booking.status_order` is not maintained by the database.** Every write that
  changes `booking_status` must set the matching `status_order` from
  `utils/bookingStatus.js`, or the row stops sorting into its group.
- **`menu_selections` stores only `{menu_item_id, quantity}`** — no price
  snapshot. Tray counts are exact; peso figures are always derived. See
  Blueprint 02 §4.
- ~~Month keys built with `toLocaleString` then re-parsed.~~ **Fixed** — both
  groupings use a numeric `year*12+month` key; the localized label is display
  only and never parsed back. Don't reintroduce string-keyed month grouping.

## Conventions worth preserving

- **`utils/reportMetrics.js` owns every money definition.** Cash figures anchor
  on `pay_datetime`; event figures anchor on `event_datetime`. Never sum
  payments inline in a page.
- **`utils/equipment.jsx` owns the stock identity** via `getStockBreakdown`.
  Never reconstruct a total by hand.
- **`utils/statusLabels.js` owns the display names for the assignment
  lifecycle.** It maps a boolean and a date to a label and never sees a stored
  value; that boundary is the point of the file. Add new status wording there,
  not in a page.
- `utils/bookingStatus.js` — `ACTIVE_BOOKING_STATUSES = ['Approved','Confirmed']`.
  Use the constant, never a bare `'Approved'` check.
- `utils/payments.js` — `isUnverifiedPayment` is the single source of truth for
  what does not count as collected money.
- The Reports drill-through pattern (click a figure → see the source rows → jump
  to the booking) and the plain-language "where this number comes from" modals
  are the module's best feature. Keep both in anything rebuilt.
- **`Reports/DateRangeFilter.jsx` is the one date-range control** — 11 instances
  across 8 pages (Bookings, Dashboard, Equipment ×2, Payments ×2, DetailModal,
  Reports/index, ShortOrders, Vehicles ×2). Its props contract is
  `preset, customStart, customEnd, rangeStart, rangeEnd, onPresetChange,
  onCustomStartChange, onCustomEndChange, onClear`. Change the component, not a
  page, when range behaviour needs to change.
- **A date range cannot be inverted.** Three layers, deliberately:
  the end input carries `min={customStart}`; moving the start past the end
  **carries the end along** rather than stranding it; and `getRangeBounds` in
  `Reports/helpers.js` swaps the pair if it ever still arrives inverted, so a
  bookmarked or restored filter can't silently return zero rows. The **start**
  input has no `max` — capping it would trap a manager who set the end first.
  A half-filled custom range says which end is missing instead of applying.
- **Forward-looking windows name both ends.** `UPCOMING_WINDOW_DAYS` in
  `Dashboard.jsx` is the window length; `upcomingWindowLabel()` renders it as
  `Aug 23 – Aug 29, 2026`. Both queries read the constant. Don't reintroduce a
  hard-coded `7` — the label and the query drifting apart is exactly the
  ambiguity the panel flagged (PR-15).
- **Past dates are trapped at `DateTimePicker.jsx`**, via
  `min={disablePast ? dateStrOffsetDays(minLeadDays) : undefined}`. Bookings,
  ShortOrders and both detail pages pass `minLeadDays={3}`.

## How the glossary sweep was done safely

Not with a blind find-and-replace — that would rename variables and, worse, the
string literals compared against database values. The sweep script stated an
**exact expected hit count for every rule** and aborted the whole run on any
mismatch; that caught one real over-match (`In repair` as a `<th>` appeared
twice under different classNames). Afterwards, three properties were asserted:
every DB-value literal byte-identical, every code identifier count unchanged,
and JSX tag structure identical to the originals.

Two deliberate exceptions, both verified line by line rather than waved through:
`'Full Payment'` survives as a `statusTabs` **key** while its **label** became
`'Fully Paid'` (the `pay_status === 'Fully Paid'` comparison is untouched), and
five files lost one balanced pair of parentheses each — the prose asides removed
from the downpayment notes.

## Two ways this collaboration has gone wrong — worth avoiding

**Stale bases.** A working copy staged earlier in a session can be several
commits behind. Re-stage immediately before editing and diff against the current
file; a stale `OverviewTab.jsx` was one commit away from silently reverting the
whole Menu Performance rebuild.

**Line endings — write LF, always.** Every blob committed in this repo is LF.
Some working-tree files had drifted to CRLF, which made them show as
whole-file diffs; 25 such files were normalised on 21 Aug 2026 and the working
tree went from 28 modified files to 3. Matching the *worktree* is the wrong
rule — match the committed blob, which means LF.

## Verifying changes here

npm's registry is blocked in some sandboxes, and `node_modules` holds Windows
binaries. When a bundler is not available: slice the plain-JS logic out of the
file and execute it in node against synthetic data, then check contracts
separately (keys destructured from `derived` vs the derived return object, dead
identifiers, bracket balance). A naive JSX tag-balance regex false-positives on
`=>` inside attributes — compare against the unedited file before believing it.
