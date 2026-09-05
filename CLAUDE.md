# CaterSync Admin — working agreement

React 19 + Vite + Tailwind 4 + Supabase. App code lives in `frontend/`.

## Read before non-trivial work

- `frontend/docs/pages/` — **one file per page**: what it is for, the rules
  that govern it, exactly which tables it reads and writes, and what is known
  to be missing. `pages/README.md` indexes them and collects every recorded
  gap in one table. Start here for a question about a specific page; the
  table/write sections are extracted from the source, so they do not drift.
- `frontend/docs/HANDOFF.md` — hard constraints, settled vocabulary, module
  ownership, and a "Things that will bite you" list. **The deep reference.**
- `frontend/docs/panel-revisions-2026-05-29.md` — every oral-defense comment,
  mapped to files and status. **This is what the project is graded against.**
  Check it before starting work and update it when an item closes.
- `frontend/docs/blueprint-01-reporting.md` / `-02-language.md` — settled
  decisions on the money model and UI vocabulary.
- `frontend/docs/ops-manager-sync.md` — **the contract with the Operations
  Manager app, and the one to read for Equipment or Vehicles.** The role, the
  exact tables and columns, the five derivations the app must copy, and §7
  Landmines. **Maintained, not a snapshot**: changing Equipment or Vehicles
  means updating it, and §0.2 is the changelog that says what broke.
- `frontend/docs/blueprint-04-mobile-sync.md` — the earlier plan for both staff
  apps. Its §5 and §7.1 are **corrected in place**, not deleted: they said
  staff cannot log in and proposed creating `staff_account`, and both are
  false — the table and `is_main_cook()` are live.

Treat decisions in those files as settled unless Vaughn says otherwise.

## Hard constraints

- **No schema changes.** Derive everything read-only from existing tables.
  Vaughn chose this explicitly.
- **The Supabase project is shared** with a groupmate's customer mobile app.
  Anything touching the database — schema, RLS, publications, or data
  backfills — affects them. Say so, and don't do it unilaterally.
- **Files are written LF.**

## Domain model — get this right before designing anything

Booking lifecycle: `Pending → Approved → Confirmed → Completed`, with
`Rejected` / `Cancelled` as terminal branches.

What happens where matters more than the names:

| Transition | Side effect |
|---|---|
| → Approved | **Equipment is auto-allocated** from the package template (`allocateEquipmentForBooking` in `useApprovalHandlers`) |
| → Confirmed | Booking **locks**: no equipment assign/edit/remove, no booking edits (`isPaymentLedgerLocked`) |

Consequences that are easy to get wrong, and have been:

- **Equipment can only be assigned while a booking is `Approved`.** Not
  Pending (nothing is allocated until approval — that's what approval does),
  not Confirmed (locked). Derive it as
  `ACTIVE_BOOKING_STATUSES.includes(s) && !isPaymentLedgerLocked(s)`, never a
  hardcoded `'Approved'`.
- **"Is this booking short of equipment?" is structurally always false** for
  Approved/Confirmed bookings, because approval allocated the whole template.
  Shortages are a **per-day, cross-event** question — several events share one
  pool of stock. A per-booking shortage metric will read zero forever.
- **Short Orders have no equipment.** Excluding them from equipment views is
  correct, not an oversight.

## Invariants that break silently

These fail without an error. Check them when touching the area.

- **`booking.status_order` IS maintained by the database — set it anyway.**
  A `BEFORE INSERT OR UPDATE OF booking_status` trigger (`set_status_order`)
  writes this column and overwrites whatever the statement supplied. Until
  5 Sep 2026 its mapping predated the Confirmed status and disagreed with
  `utils/bookingStatus.js` on four of six values, which is what made Confirmed
  rows sort into Rejected's slot. `sql/fix_status_order_trigger.sql` corrected
  it; the two now agree.

  Every write that changes `booking_status` must **still** set the matching
  value from `utils/bookingStatus.js`, and the self-heal
  (`findStatusOrderDrift`) must stay — but note the reason has changed. It is
  no longer that the column is unmaintained. It is that this app cannot depend
  on a trigger it does not own: the mobile repo writes `booking_status` too and
  knows nothing about it, and a database restored from a backup taken before
  5 Sep reinstates the old function silently.

  One consequence is load-bearing: the self-heal works **only** because its
  UPDATE touches `status_order` alone, so the trigger — scoped to
  `UPDATE OF booking_status` — does not fire on it. Never fold the repair into
  a status change.
- **Realtime on an unpublished table reports `SUBSCRIBED` and delivers
  nothing, forever.** Any new table you subscribe to must be added to the
  `supabase_realtime` publication. Row-filtered subscriptions also need
  `REPLICA IDENTITY FULL` unless the filter is on the primary key.
- **Subscriptions must not capture stale state.** Use
  `hooks/useRealtimeRefresh.js`, never an inline `useEffect(..., [])` whose
  handler calls a fetcher — it captures the first render's closure and will
  refetch page 1 while the user is on page 2.
- **`.range()` paging needs a total sort.** Always end an ordering chain with a
  unique column (`booking_id`), or rows skip and repeat across pages.

## Module ownership — don't reimplement these

| Concern | Owner |
|---|---|
| Money definitions | `utils/reportMetrics.js` |
| Stock totals | `getStockBreakdown` in `utils/equipment.jsx` |
| Equipment demand from a package | `deriveEquipmentDemand` in `utils/equipment.jsx` |
| Assignment lifecycle wording | `utils/statusLabels.js` |
| Booking status constants | `utils/bookingStatus.js` |
| What counts as collected money | `utils/payments.js` |
| Date range control | `Reports/DateRangeFilter.jsx` |
| Dropdowns | `components/Select.jsx` |

If a rule needs to exist in two places, extract it into one and have both call
it — duplicated rules drift, and that drift has caused real bugs here (a
displayed availability number that disagreed with the one being validated).

## How to work on this project

1. **Plan before building anything non-trivial.** State the approach and the
   assumption it rests on before writing code. The expensive mistakes here
   have been well-built features resting on a wrong premise, not bad code.
2. **Verify claims against real data**, not reasoning alone. Query Supabase in
   the browser, or exercise the pure function. Several "fixes" this project
   has needed were found only by checking actual rows.
3. **Say what wasn't verified.** RLS hides `equipment`, `booking_equipment` and
   `package_equipment` from an unauthenticated client, and there is no manager
   login available in-session — so those paths are usually code-reviewed, not
   exercised. Flag that rather than implying it was tested.
4. **Build after changes** (`cd frontend && npm run build`). It catches the
   import and JSX errors that a large edit tends to introduce.
5. **Don't push without being asked.** `main` auto-deploys to Vercel
   production.
6. **Update the panel tracker** when work closes one of its items, including
   the evidence — that file is the graded artifact.
