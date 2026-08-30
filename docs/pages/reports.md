# Reports

`/app/reports` — **src/pages/Reports/index.jsx** (674 lines)

## What it is for
Six tabs of derived reporting: overview, financial, menu performance,
equipment and vehicle utilization, and a historical booking summary. Reads
only — it writes nothing.

## Rules that matter
- Two anchors, never mixed. `pay_datetime` answers 'how much cash came in' (`getPaymentsReceived`); `event_datetime` answers 'what are this period's events worth' (`contractValue` / `paidAgainstEvents` / `outstanding`). Conflating them is what made this page disagree with the Dashboard.
- The collection percentage divides `paidAgainstEvents` by `contractValue` — both event-anchored, so the ratio is like-for-like — and prints the division underneath.
- `refundsNettedAgainstReceived`, not `refundsIssued`, is the figure quoted beside collections: refunds on cancelled bookings never entered that total.
- Every query pages through `fetchAllRows`. Reports silently under-reported past 1000 rows before this.

- Vehicle figures answer two different questions and must not be merged: **on the road now** counts vehicles whose dispatch window contains this moment, while **booked** counts any live assignment. A van reserved for a wedding three weeks out is booked, not on the road.
- **Fleet utilization** is vehicle-hours on the road over vehicle-hours available across the range — a share of a whole, per blueprint-02 §4. Only in-service vehicles count toward the denominator, and an unbounded range yields no figure at all rather than an invented one.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking_equipment` | 1 | no |
| `category` | 1 | no |
| `equipment` | 1 | no |
| `menu_item` | 1 | no |
| `package` | 1 | no |
| `package_category` | 1 | no |
| `payment` | 1 | no |
| `vehicle` | 1 | no |
| `vehicle_assign` | 1 | no |

## Data it writes

_Writes nothing._

## Shared modules it depends on

- **utils:** `bookingStatus`, `equipment.jsx`, `fetchAllRows`, `payments`, `reportMetrics`
- **hooks:** _none_
- **realtime:** none

## Review status

Audited; three calculation errors in the source brief were corrected rather than reproduced.

## Known gaps

- Terminology conflict: the glossary says 'Payments Received', the live screens say 'Total Collections'. The screens won; the glossary row is stale.
