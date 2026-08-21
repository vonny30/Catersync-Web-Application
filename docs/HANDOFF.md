# CaterSync Admin — working context

Read this first, then the two blueprints beside it. They are the agreed plan for
this codebase; treat their decisions as settled unless Vaughn says otherwise.

- `blueprint-01-reporting.md` — turning Reports from a metrics dashboard into
  business reporting. Money model, defect list, report catalogue, build order.
- `blueprint-02-language.md` — the UI vocabulary standard and the corrected
  report percentage maths. Screen-by-screen rewrite table.

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

**Next up** — Blueprint 02 §9 step 6: the remaining screen-by-screen items in
§6. Each screen's table is independent, so this can be done in any order and
stopped at any point.

**Deliberately not touched yet** — `FinancialTab.jsx:53` still reads "Monthly
Revenue (Net Collected)". Renaming it would be premature: that chart is
currently *gross*, because negative amounts are skipped when the series is
built (Blueprint 01 defect 5). Fix the maths first, then the label.

**Not started** — everything in Blueprint 01. Its Phase 0 defect 1 (unbounded
report queries hitting the PostgREST 1000-row cap) is the most urgent single
item in either document; it fails silently and gets worse on its own.

## Things that will bite you

- **`Reports/index.jsx` fetches ten tables with no `.range()`/`.limit()`.**
  Supabase caps responses at 1000 rows by default. `Bookings.jsx:193` and
  `ShortOrders.jsx:170` paginate; Reports does not. Past the cap every report
  figure is silently wrong and nothing throws.
- **Dashboard and Reports compute "collected" differently.**
  `Dashboard.jsx:233-243` sums every verified payment dated this month.
  `Reports/index.jsx` sums verified payments on bookings whose *event* falls in
  range. They will not agree. Blueprint 01 §2 is the fix.
- **`booking.status_order` is not maintained by the database.** Every write that
  changes `booking_status` must set the matching `status_order` from
  `utils/bookingStatus.js`, or the row stops sorting into its group.
- **`menu_selections` stores only `{menu_item_id, quantity}`** — no price
  snapshot. Tray counts are exact; peso figures are always derived. See
  Blueprint 02 §4.
- **Month keys are built with `toLocaleString` then re-parsed with
  `new Date("Aug 2026")`** in several places. Implementation-defined parsing;
  breaks under a non-English browser locale.

## Conventions worth preserving

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

## Verifying changes here

npm's registry is blocked in some sandboxes, and `node_modules` holds Windows
binaries. When a bundler is not available: slice the plain-JS logic out of the
file and execute it in node against synthetic data, then check contracts
separately (keys destructured from `derived` vs the derived return object, dead
identifiers, bracket balance). A naive JSX tag-balance regex false-positives on
`=>` inside attributes — compare against the unedited file before believing it.
