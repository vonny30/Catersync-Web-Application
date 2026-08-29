# Dashboard

`/app` — **src/pages/Dashboard.jsx** (1528 lines)

## What it is for
The first screen after sign-in. Answers "what needs me today?" — today's
events, pending bookings and short orders awaiting a decision, collections
so far this month, and a month calendar of confirmed work.

It writes nothing itself. The approve/reject actions on its pending list are
the shared handler hooks, so a decision made here is identical to one made on
a list page.

## Rules that matter
- Money comes from `getPaymentsReceived` in `utils/reportMetrics` — the same function Payments and Reports use, so the three cannot disagree.
- Cash retained from cancelled bookings is reported on its own line, never folded into the headline collections figure.
- Date windows are sent as **instants** (`toISOString()`), never naive local strings. `pay_datetime` and `event_datetime` are `timestamptz`; a naive string is read in the database's timezone (UTC), which shifted every window 8 hours in Manila.
- Windows are half-open `[start, end)`. An inclusive `23:59:59` end drops the final second.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 8 | no |
| `payment` | 2 | no |

## Data it writes

_Writes nothing._

## Shared modules it depends on

- **utils:** `bookingStatus`, `fetchAllRows`, `payments`, `reportMetrics`
- **hooks:** `useApprovalHandlers`, `useRealtimeRefresh`, `useRejectionHandlers`
- **realtime:** channel `dashboard-page` on `booking`, `payment`
- **realtime:** channel `dashboard-calendar` on `booking`

## Review status

Audited 30 Aug 2026 — row cap and timezone both fixed.

## Known gaps

- `generateCalendar` is called three lines above its own declaration. Safe only because the call sits in a `useEffect`, which runs after render. One reorder from a crash.
- Never rendered under review — RLS blocks an unauthenticated client, so layout is code-reviewed only.
