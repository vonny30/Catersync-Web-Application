# CaterSync Admin — working context

Read this first, then the two blueprints beside it. They are the agreed plan for
this codebase; treat their decisions as settled unless Vaughn says otherwise.

- `blueprint-01-reporting.md` — turning Reports from a metrics dashboard into
  business reporting. Money model, defect list, report catalogue, build order.
- `blueprint-02-language.md` — the UI vocabulary standard and the corrected
  report percentage maths. Screen-by-screen rewrite table.
- `blueprint-03-dispatch.md` — the Vehicles page: the job of the page, the
  eight moments where a vehicle attaches to a booking, the dispatch-window
  model, and a screen-by-screen concept. Phase 1 is built; §9 holds four
  decisions Vaughn has not answered yet.
- `ops-manager-sync.md` — **the contract with the Operations Manager mobile
  app.** The role, what it must and must not do, the exact reads and writes, and
  the five derivations it has to copy from `utils/vehicle.js` and
  `utils/equipment.jsx`. **This file is maintained, not a snapshot** — see the
  rule under *Conventions worth preserving*.
- `mobile-contract.md` — the rules every client sharing this database must
  honour, whichever app it is.
- `blueprint-04-mobile-sync.md` — the plan for the Main Cook and Operations
  Manager apps, and the one schema decision that blocks half of it.
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

- **Blueprint 03 Phase 1, the dispatch model** (28 Aug 2026). `utils/vehicle.js`
  and `Vehicles.jsx`. Nothing looks different except that a second same-day trip
  stops disappearing — the value is in the four defects closed underneath. See
  *Conventions worth preserving* and blueprint-03 §8.

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

## Payment workflow

Closes PR-20 and PR-21. The panel assumed a booking is confirmed before a
payment is recorded. It is the other way round.

```
Customer submits booking request
  -> Manager reviews and approves     (booking_status: Pending -> Approved)
  -> Customer submits proof of payment
  -> Manager verifies the proof       (pay_status: Pending Verification -> Downpayment | Fully Paid)
  -> Booking is confirmed             (booking_status: Approved -> Confirmed, ledger locks)
```

**Payments become possible at Approved, not at Confirmed.**
`BookingDetails.jsx` already gates the payment panel on it — "Approve this
booking to enable payments". Confirmation is the *consequence* of a verified
payment covering at least 50%, not a precondition for recording one.

**Editing a payment is not possible, and that IS the answer to PR-21.** The
panel asked what editing is for; the resolution was to remove it. A payment row
only exists because a manager recorded it by hand or verified a customer's
proof, so there is no state in which silently rewriting one is the right move.
`Payments.jsx` states the rule where the handlers used to be.

What replaces it:

| Situation | What to do instead |
|---|---|
| Wrong amount or method recorded | Record a correcting entry; the ledger is append-only |
| Money going back to the customer | A **refund**, which is its own entry — never a negative payment (PR-23) |
| The customer owes a different amount | The approval-time fee adjustment (`extraQuantity`, `extraDeliveryFee`, `additionalFee`), which changes the booking total with a reason attached |

The distinction in the last row is the one worth keeping: a fee adjustment is
recorded against the booking and carries why it changed. An edited payment
would silently become the new truth of what was received, losing the reason.

**Editing a booking is locked when recomputing its total would lower it.**
The fee adjustment in that last row created a trap: approval folds
`extraQuantity`, `extraDeliveryFee` and `additionalFee` into `total_amount`,
but `Approved` is not a locked status, and both edit forms recompute the total
from package/menu plus delivery fee — which cannot see those additions. Opening
the modal and saving wrote the lower number back and the adjustment was gone.

Detected from the money, because there is nothing else: no column records the
adjustment, and approval writes an `[APPROVAL]` note for short orders but
**none** for packages. `totalLossOnRecompute` in `utils/payments.js` compares
the stored total against what the form would recalculate, with a one-peso
tolerance for rounding; a stored total that is higher means value is present
that recomputation cannot reproduce, and Edit locks with the amount named.

Two deliberate properties:

- **It catches more than approval fees.** A menu price that has *dropped* since
  the booking was taken has the same shape, and locking is right there too. The
  message states what was detected rather than asserting a cause.
- **It fails toward staying out of the way.** A price that *rose* loses nothing
  on recompute, so the record stays editable — as does one whose package or
  menu items have not loaded yet, since an incomplete read must not lock a
  record.

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

- **The Supabase anon key is in the client bundle. RLS is what protects it, and
  as of 3 Sep 2026 it does.** `VITE_`-prefixed variables are inlined at build
  time, so `VITE_SUPABASE_ANON_KEY` ships in the JavaScript Vercel serves to
  every visitor. That is normal, and safe *only* because row-level security
  stands behind it.

  **It was not safe until 3 Sep.** `booking`, `customer` and `payment` each
  carried a policy granting `anon` access with `USING (true)`, and one on
  `booking` was an `UPDATE` whose `WITH CHECK` constrained only
  `booking_status` — leaving `total_amount`, `venue`, `event_datetime` and
  `pax_count` writable by anyone with the key. All four are dropped. Verified:
  the anonymous request that returned 11 bookings, 21 customers and every
  payment row now returns nothing. `docs/db-changes-2026-09-03.md` records it
  with the revert script, and `ops-manager-sync.md` landmine 9 carries the
  client-side version.

  Two things worth keeping from that episode. The line *"the anon key is public
  by design, so it isn't a leak"* was written here twice while it was false —
  it is a rule about a **well-configured** project, not a fact about any
  project, so check the policies before saying it. And untracking `.env` on
  3 Sep reduced exposure by **nothing**: the key was already in every build.
  That was for diff noise, and nothing else.

- ~~`Reports/index.jsx` fetches ten tables with no `.range()`/`.limit()`.~~
  **Fixed** — `fetchAll()` pages with a stable `.order()` on each primary key.
- ~~Dashboard and Reports compute "collected" differently.~~ **Fixed** — all
  three pages now import `utils/reportMetrics.js`. Anything new that reports
  money must use it too rather than summing payments inline; that inline sum is
  how three different answers appeared in the first place.
- ~~Six unbounded vehicle queries.~~ **Fixed** — `Vehicles.jsx` and
  `utils/vehicle.js` page every read through `fetchAllRows`. `vehicle_assign`
  is the table most likely to cross 1000 rows next; it grows with every trip.
- **`booking.status_order` is not maintained by the database.** Every write that
  changes `booking_status` must set the matching `status_order` from
  `utils/bookingStatus.js`, or the row stops sorting into its group.
- **`menu_selections` stores only `{menu_item_id, quantity}`** — no price
  snapshot. Tray counts are exact; peso figures are always derived. See
  Blueprint 02 §4.
- ~~Month keys built with `toLocaleString` then re-parsed.~~ **Fixed** — both
  groupings use a numeric `year*12+month` key; the localized label is display
  only and never parsed back. Don't reintroduce string-keyed month grouping.
- **A realtime subscription to an unpublished table fails silently.** It
  reports `SUBSCRIBED` and then delivers nothing, forever, with no error. This
  had already happened here: `Bookings.jsx`, `ShortOrders.jsx` and the
  ManagerLayout payment badge all subscribed to `booking`/`payment`, but only
  `manager` was in the `supabase_realtime` publication (added for the session
  lock), so none of those three had ever refreshed. Fixed 24 Aug 2026 by
  publishing the seven operational tables. **Any new table you subscribe to
  must be added to the publication as well** — see the docblock on
  `hooks/useRealtimeRefresh.js` for the check query.

  Row-filtered subscriptions (`{ table, filter }`) have a second requirement:
  on DELETE the filter is matched against the OLD row, which by default holds
  only the primary key. A filter on any other column therefore misses deletes
  unless that table is `REPLICA IDENTITY FULL`. This is why `payment`,
  `booking_equipment` and `vehicle_assign` are set FULL — the detail pages
  filter them on `booking_id`, which is not their PK. `booking` doesn't need
  it, since it is filtered on its own primary key.

## Conventions worth preserving

- **Changing Equipment or Vehicles means updating `ops-manager-sync.md`.** The
  Operations Manager mobile app is built against that file, and it duplicates
  rules that live in `utils/vehicle.js` and `utils/equipment.jsx` because the
  two apps cannot share code. A change here that does not reach that document
  becomes a phone and a laptop disagreeing about the same van on the same day,
  which is worse than either being wrong alone.

  It is not finished until §0.1 (the constants table) matches the code and §0.2
  (the changelog) has a dated row saying what the mobile side has to do about
  it. §0.3 lists exactly what triggers this. Treat it the way you would treat a
  failing test: part of the change, not follow-up work.

  The rules that most often drift: `TRIP_PROFILE`, `PICKUP_GRACE_HOURS` (which
  is load-bearing twice — the collection run's departure AND the return
  checklist's unlock), the setup/collection leg derivation, the stock identity,
  and the short-order pickup marker.

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
- **`utils/vehicle.js` owns the dispatch window.** A vehicle is exclusive for
  the length of a **trip**, never for a calendar day — that distinction is the
  whole reason three vehicles can serve more than three events. `TRIP_PROFILE`
  and `TURNAROUND_HOURS` are the calibration knobs and are meant to be edited;
  `getDispatchWindow` and `windowsOverlap` are the only correct way to ask
  whether two dispatches collide. Never compare event dates with
  `toDateString()` to answer that question — that comparison is the defect
  blueprint-03 D1 exists to remove, and `Vehicles.jsx:611` and `:2136` still
  carry it until Phase 2.
- **`getDailyVehicleSnapshot` returns an `assignments` ARRAY per vehicle**, not
  a single slot. The old scalar shape silently kept only the last trip read,
  which is invisible until the day a van does two runs. Anything consuming the
  snapshot must handle 0, 1 or many.
- **A vehicle with dispatch history is retired, not deleted.** Flag issue →
  Unavailable. Deleting it would take its `vehicle_assign` rows with it, and
  those rows are what the utilization reports are built from. Same rule as
  Equipment.
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
