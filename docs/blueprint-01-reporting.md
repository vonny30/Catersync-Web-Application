# Blueprint 01 — Reporting

From metrics dashboard to business reporting. Drafted 21 Aug 2026.
Scope: Reports module + shared metrics. Constraint: read-only against the
current schema. Audience: owner/manager decisions.

Rendered version: https://claude.ai/code/artifact/d40e16ca-b8ef-494c-a6c3-e77dfb7f1732

---

## 1. Diagnosis

Every metric in `Reports/index.jsx` is computed correctly against its own
definition. The definitions were chosen to make cards render, not to answer
decisions. Three symptoms:

**One anchor date for everything.** Nearly every figure hangs off
`event_datetime`, so a ₱80,000 deposit banked in August against a December
wedding is invisible in an August report. Real reporting uses three different
anchor dates depending on the question.

**No comparison.** Every number stands alone. "Collected: ₱412,000" is not
information; "₱412,000, down 18% from last August" is.

**Pipeline counted as earnings.** `Total Revenue` excludes only Rejected and
Cancelled, so every Pending inquiry is added to revenue until somebody rejects
it. The number goes down when a manager does paperwork.

## 2. The four money questions

| # | Question | Term | Anchor | Includes | Today |
|---|---|---|---|---|---|
| Q1 | How much business did we win? | **Sales Booked** (contract value) | `book_datetime` | Approved, Confirmed, Completed | Absent — Total Revenue anchors on event date instead |
| Q2 | How much have we earned? | **Revenue Earned** (recognised) | `event_datetime` | **Completed only** | Partially — it's what Booking Summary computes, filed as history |
| Q3 | How much cash came in? | **Collections** | `pay_datetime` | verified payments, refunds netted | Two different answers (Dashboard vs Reports) |
| Q4 | What are we owed / holding? | **AR** + **Deposits Held** | balance as at a date | see below | Conflated into one "Outstanding" |

### The split that matters most

Today's single Outstanding figure adds two amounts demanding opposite behaviour:

| Amount | What it is | Condition | Owner does |
|---|---|---|---|
| **Accounts Receivable** | Money legally owed — food served, balance unpaid | Completed, unpaid balance > 0 | Chase it today |
| **Backlog balance** | Not owed yet — balance falls due on event day | Approved/Confirmed, event ahead | Nothing |

Its mirror is **Deposits Held** — cash collected against events not yet
delivered. A liability, not income. Answers "how much of my bank balance is
actually mine?"

### The reconciliation

```
Sales Booked − Revenue Earned = Order Backlog
Collections − Refunds         = Net Cash In

Revenue Earned − collections against completed events = Accounts Receivable
collections against future events                     = Deposits Held
```

All four sides derive from `booking` and `payment` alone. The work is
definitional, not structural.

## 3. Verified defects

Ordered by cost, not effort.

| # | Defect | Where | Severity |
|---|---|---|---|
| 1 | **Reports silently under-report past 1,000 rows.** All ten queries run with no `.range()`/`.limit()`. PostgREST caps at the project max-rows (Supabase default 1000). `Bookings.jsx:193` paginates; Reports doesn't. Past the cap every figure is quietly wrong and nothing throws. | `Reports/index.jsx:60-75` | Critical |
| 2 | **Total Revenue includes Pending inquiries.** The active filter removes only Rejected and Cancelled. | `Reports/index.jsx:135` | Critical |
| 3 | **Two different "collected" numbers.** Dashboard sums every verified payment dated this month; Reports sums verified payments on bookings whose *event* falls in range. | `Dashboard.jsx:233-243`, `Reports/index.jsx:141` | High |
| 4 | **Equipment and Vehicle tabs ignore the date filter.** Live snapshots under a prominent date-range control; the disclaimer is 11px grey text below four stat cards that also don't respect it. | `Reports/index.jsx:307,327`, `EquipmentUtilizationTab.jsx:75` | Medium |
| 5 | **The "Net Collected" chart is gross.** Negative amounts skipped when building the series, so refunds never pull a bar down — while heading and caption both say net. | `Reports/index.jsx:183` | Medium |
| 6 | **Refunds reconcile to nothing.** The panel collects refunds regardless of booking status; Collected only sums payments on active bookings. A refund on a cancelled booking appears in the panel and reduces no figure above it. | `Reports/index.jsx:141,196-214` | Medium |
| 7 | **Month keys round-trip through locale strings.** Built with `toLocaleString('default',…)` then sorted by `new Date("Aug 2026")`. Implementation-defined; yields `Invalid Date` under a non-English locale. | `Reports/index.jsx:185,188-190,372` | Medium |
| 8 | **Same panel, two meanings of revenue.** Top card is contract value; the chart beneath is cash collected. Both called revenue. | `FinancialTab.jsx:28,53` | Medium |
| 9 | **A caption that contradicts its number.** Collected card reads "All payments received." It's event-anchored. | `FinancialTab.jsx:38` | Low |
| 10 | **Booking Summary rows aren't chronological.** Month groups mapped straight from `Object.entries` with no sort, while `RPT-1, RPT-2…` ids imply a sequence. | `Reports/index.jsx:382` | Low |
| 11 | **Financial tab shows only three months.** Hard `.slice(0,3)`, no total, no "view all". | `FinancialTab.jsx:186` | Low |
| 12 | **Packages and menu items ranked in one list.** | `Reports/index.jsx:270-273` | Critical |
| 13 | **Performance % is share of the biggest, not share of the whole.** Top row always reads exactly 100%. | `Reports/index.jsx:275-280` | Critical |
| 14 | **A column headed "Popularity" that measures money.** | `MenuPerformanceTab.jsx:24,42` | High |
| 15 | **Every menu item renders red.** Threshold is 10% of a package's revenue. | `Reports/index.jsx:284`, `MenuPerformanceTab.jsx:59` | Medium |
| 16 | **Category bars are share-of-max on a double-counted base.** | `Reports/index.jsx:296-304`, `MenuPerformanceTab.jsx:99` | Medium |
| 17 | **Menu item revenue restated at today's prices.** `menu_selections` has no price snapshot. | `Reports/index.jsx:257-267` | Medium |
| 18 | **"Available vehicles" counts broken ones.** `available = total − dispatched`, so a van flagged Maintenance and not dispatched reads as free. | `VehicleUtilizationTab.jsx:7,49` | Medium |

Defects 12–17 are **fixed** — see `blueprint-02-language.md` §4 and the shipped
code in `src/pages/Reports/`. Defect 1 (the 1000-row cap) is fixed: every report
query pages through `fetchAllRows`. Defect 18 is fixed: "available" now means in
service AND not out, so a van under maintenance no longer reads as free.
Defects 2–11 remain open.

**Defect 1 is the one to fix first.** It's the only one that gets worse on its
own, and it fails silently. Either paginate the report queries or push
aggregation into Postgres views — read-only from the app's point of view, and it
doesn't touch table schema.

## 4. Report catalogue

Twenty-two reports, named for the decision each drives. All buildable read-only.

### A · Money
- **A1 Income & Collections Summary** — Booked / Earned / Collected / Backlog with prior-period and prior-year variance. *Is the business growing, and on which measure?* — New
- **A2 Cash Collections** — by method and day, refunds netted. *Which channels are used; is GCash worth the fees?* — Rework
- **A3 Receivables Aging** — Current / 1-30 / 31-60 / 61-90 / 90+ days past event, with customer contact. *Who to call this morning.* **Highest-value report on this list.** — New
- **A4 Deposits Held** — cash collected against undelivered events, by event month. *How much of the bank balance is spoken for.* — New
- **A5 Order Backlog** — contracted value by future month. *Is next quarter sold?* — New
- **A6 Cancellation & Refund Loss** — value lost, refund rate, stage bookings die at. *Is the deposit policy working?* — Rework

### B · Sales & demand
- **B1 Booking Funnel** — cohort-correct: of bookings submitted in the period, what share reached each stage. — Rework
- **B2 Average Booking Value & Pax** — trended. — New
- **B3 Booking Lead Time** — median days from `book_datetime` to `event_datetime`. *When to advertise and hire; whether the 3-day rule fits behaviour.* — New
- **B4 Seasonality** — events and revenue by month and day of week. *Which months carry the year.* — New
- **B5 Demand vs Capacity** — events per day against the ceiling; days at capacity vs idle. Short Order ceiling is `MAX_SHORT_ORDERS_PER_DAY`; for packages, equipment stock is the real constraint, so E2 supplies it. — New

### C · What sells
- **C1 Package Mix & Pareto** — **rebuilt, shipped**
- **C2 Menu Item Movement** — **rebuilt, shipped**
- **C3 Category Demand** — **rebuilt, shipped**
- **C4 Price Realisation** — actual revenue per head vs list price. *How much is given away in approval-time fee adjustments.* — New

### D · Customers
- **D1 New vs Repeat** — split and repeat rate per period. — Rework
- **D2 Top Customers by Lifetime Value** — New
- **D3 Dormant Customers** — no booking in N months, ranked by past spend. *The win-back list.* — New
- **D4 Walk-in vs App-registered** — *Is the customer app earning its keep?* Depends on walk-ins being distinguishable via `customer.account_status` or an empty `username` — confirm with one query first. — New

### E · Operations
- **E1 Events & Pax Served** — New
- **E2 Equipment Peak Demand & Shortfall** — per item, highest concurrent committed quantity across the forward calendar vs units owned. *What to buy, and which future dates you're already short on.* **Most valuable ops report here**, and impossible from the current live snapshot. Must fall back to the package equipment template for unassigned bookings — reuse `ApprovalAvailabilityCheck.jsx`'s logic so the report and the approval screen agree. — New
- **E3 Dead Stock** — equipment unassigned all period. — New
- **E4 Return Compliance** — assignments unreturned N days after the event. — New
- **E5 Damage & Maintenance** — snapshot only; no history table, so no trend. — Keep
- **E6 Vehicle Load** — dispatches per vehicle, idle vehicles. — Rework

## 5. Report mechanics

1. **Fiscal periods, not ad-hoc ranges** — This Month / Last Month / This Quarter / This Year / Last Year / Custom. "Last 30 Days" is a dashboard idea.
2. **Comparison on every headline figure** — delta vs prior period *and* same period last year, in peso and percent. Highest-value single change in the document.
3. **Basis and anchor stated on screen** — e.g. `Accrual basis · anchored on event date · Completed only`. Would have prevented defects 3, 8 and 9 outright.
4. **One shared metrics module** — `src/utils/reportMetrics.js` owning the §2 definitions, imported by Dashboard, Payments and Reports. Makes disagreement impossible rather than merely unlikely.
5. **A report header block for print** — business name, report title, period covered, basis, generated-on, generated-by. ~40 lines of CSS in `@media print`.
6. **Export** — CSV client-side, no new dependency, plus a print stylesheet. Nothing is snapshotted server-side, so exports are also the only historical archive.
7. **An exceptions list** — surface only what breached a threshold: receivables past 30 days, cancellation rate above target, equipment short on a date, a top customer gone dormant.

## 6. Tab layout

| Today | Proposed | Holds |
|---|---|---|
| Overview | **Business Review** | Reconciliation, variance, exceptions list |
| Financial | **Money** | A1–A6 |
| Booking Summary | **Sales** | B1–B5 |
| — | **Customers** | D1–D4 |
| Menu Performance | **Menu & Packages** | C1–C4 — *renamed already* |
| Equipment + Vehicle Utilization | **Operations** | E1–E6 |

## 7. Build order

- **Phase 0 — Stop the bleeding.** Paginate the report queries or move aggregation into views (1); exclude Pending from revenue (2); fix locale-string month sorting and Booking Summary order (7, 10); correct contradictory captions (5, 8, 9, 11). *Everything later reads these numbers.*
- **Phase 1 — The money model.** Build `reportMetrics.js`; repoint Dashboard, Payments and Reports at it (3, 6); add fiscal periods and prior-period comparison. *Invisible to the user, foundation for everything.*
- **Phase 2 — Business Review tab.** Reconciliation, variance, exceptions list. *First phase the owner can feel.*
- **Phase 3 — Money tab.** A3 aging first, then A4, A5, then A1/A2/A6 rebuilt. *A3 alone changes how the business operates on a Monday.*
- **Phase 4 — Sales, Customers, Menu.** B, D, remaining C. Print header and CSV export.
- **Phase 5 — Forward-looking operations.** E2 first. Print stylesheet finished.

## 8. Honest limits of the current schema

| Limit | Consequence | Best available answer |
|---|---|---|
| **No cost data anywhere** | No margin, no profit, no true P&L. This is sales and cash reporting — label it that way. | A manager-set food-cost % and monthly target in `localStorage` gives estimated margin and target variance with no schema change. Label it as an assumption on the page, every time. |
| **No audit columns** | No accountability reporting; no way to reconstruct a disputed figure. | None without schema change. First column to add if the constraint lifts. |
| **No period snapshots** | Last year's reported figure moves if an old row is edited. | Exports become the archive. |
| **No equipment status history** | E5 can report today's position, not a trend. | Report as a snapshot and say so. |
| **No lead/enquiry capture** | The funnel starts at "booking submitted"; true conversion is unknowable. | Call it a *booking* funnel, not a sales funnel. |
