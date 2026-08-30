# Page reference

One file per page: what it is for, the rules that govern it, exactly which
tables it touches, and what is known to be missing. Written so a question
about a page can be answered here instead of re-derived from the code.

The tables and write counts are **extracted from the source**, not written by
hand, so they cannot quietly drift. The rules and gaps come from review.

Read alongside `../HANDOFF.md` (hard constraints), `../mobile-contract.md`
(rules every client sharing the database must honour) and the numbered
blueprints (settled decisions on money, language and dispatch).

## The pages

| Page | Route | Lines | Unbounded reads | Review status |
|---|---|---|---|---|
| [Dashboard](dashboard.md) | `/app` | 1528 | — | Audited 30 Aug 2026 — row cap and timezone both fixed. |
| [Bookings](bookings.md) | `/app/bookings` | 2356 | **2** | Sorting, paging and the responsive table reviewed. Business logic mostly delegated to the hooks, which were audited separately. |
| [Short Orders](short-orders.md) | `/app/orders` | 2131 | **2** | Reviewed alongside Bookings; same treatment, same conclusions. |
| [Booking Details](booking-details.md) | `/app/bookings/:id` | 2706 | **1** | Audited 30 Aug 2026 — the destructive re-allocation and the delete messaging were fixed. |
| [Short Order Details](short-order-details.md) | `/app/orders/:id` | 1954 | — | Reviewed alongside Booking Details. |
| [Payments](payments.md) | `/app/payments` | 2407 | — | Modernized and audited; the verification-first rule was added 30 Aug 2026. |
| [Equipment](equipment.md) | `/app/equipment` | 3852 | **2** | Heavily reviewed. History grouping and the assign-modal allocation plan added 29-30 Aug 2026. |
| [Vehicles](vehicles.md) | `/app/vehicles` | 2648 | — | Audited 30 Aug 2026 — the page's own logic reviewed, layout modernized, history grouped by booking. The dispatch model's pure functions were tested separately (14/14). |
| [Reports](reports.md) | `/app/reports` | 674 | — | Audited; three calculation errors in the source brief were corrected rather than reproduced. |
| [Packages & Menu](packages-and-menu.md) | `/app/packages` | 1415 | **3** | Audited 30 Aug 2026 — the unarchive wording plus three robustness gaps. |
| [Settings](settings.md) | `/app/settings` | 546 | — | Audited 30 Aug 2026 after a reported error; the global-signOut bug was found here. |
| [Login](login.md) | `/login` | 332 | — | Rebuilt and verified in a real browser at 360-3840px. |
| [Forgot Password](forgot-password.md) | `/forgot-password` | 301 | — | Built and exercised against real Supabase (send leg and a rejected code). |
| [Reset Password](reset-password.md) | `/reset-password` | 190 | — | Audited 30 Aug 2026. |

## What is lacking

Every open gap across the pages, so the list can be worked through rather
than rediscovered. Settled items are struck through in the page files and
drop off this table.

| Page | Gap |
|---|---|
| [Dashboard](dashboard.md) | `generateCalendar` is called three lines above its own declaration. Safe only because the call sits in a `useEffect`, which runs after render. One reorder from a crash. |
| [Dashboard](dashboard.md) | Never rendered under review — RLS blocks an unauthenticated client, so layout is code-reviewed only. |
| [Bookings](bookings.md) | Two whole-table reads with no row bound (`booking`, `customer`) — PostgREST truncates at 1000 without an error. |
| [Bookings](bookings.md) | The page's own money display was not audited independently of the hooks. |
| [Short Orders](short-orders.md) | Same two unbounded whole-table reads as Bookings. |
| [Booking Details](booking-details.md) | One unbounded whole-table read (`equipment`). |
| [Booking Details](booking-details.md) | The equipment quantity edit's stock check reads `booking_equipment` for one equipment id unbounded — bounded in practice, not in principle. |
| [Short Order Details](short-order-details.md) | Not exercised against real data. |
| [Payments](payments.md) | Verification computes `finalStatus` before the password prompt, so a payment arriving during the prompt could mislabel Downpayment vs Fully Paid. Display-only, recomputed by `describePaymentKind`. |
| [Equipment](equipment.md) | Two unbounded whole-table reads (`equipment`, `package_equipment`). |
| [Equipment](equipment.md) | RLS hides `equipment`, `booking_equipment` and `package_equipment` from an unauthenticated client, so these paths are code-reviewed rather than exercised. |
| [Vehicles](vehicles.md) | Blueprint-03 §5.8 is still open: `BookingDetails` and `ShortOrderDetails` mention a vehicle only in the delete warning, so a booking cannot show what is carrying it. |
| [Vehicles](vehicles.md) | `blueprint-03-dispatch.md` documents a superseded model (`leadHours`/`serviceHours`/`returnHours`); the code implements `travelHours`/`setupHours`/`teardownHours`/`hasPickup`. |
| [Reports](reports.md) | Terminology conflict: the glossary says 'Payments Received', the live screens say 'Total Collections'. The screens won; the glossary row is stale. |
| [Packages & Menu](packages-and-menu.md) | Three unbounded whole-table reads remain in the form/dropdown fetches (`package`, `menu_item`, `category`). |
| [Packages & Menu](packages-and-menu.md) | `package_menu` is written by nothing in this app; the delete guard checks it defensively in case another client populates it. |
| [Settings](settings.md) | The 50%-downpayment and balance rules live here and in `usePaymentHandlers` and Payments — three copies of similar validation. |
| [Forgot Password](forgot-password.md) | Entering a genuine code end-to-end needs a real inbox; not yet done. |
| [Reset Password](reset-password.md) | The full flow with a genuine code has not been run end-to-end. |

## Recently settled

- **`vehicle_assign` has no unique constraint on booking+vehicle** (30 Aug
  2026). The table carries three foreign keys and a primary key on
  `assignment_id`, and nothing else, so the dispatch model's pickup leg
  persists as designed. The code had asserted the opposite in a comment.
- **`payment.pay_datetime` is `timestamp with time zone`** (30 Aug 2026),
  which is why the Dashboard's naive local date strings shifted every window
  eight hours. Boundaries are now sent as instants.

## Keeping this honest

The mechanical sections regenerate from the source. When a page changes
shape — a new table, a new write, a read that loses its bound — regenerate
rather than editing those tables by hand. When a rule or a gap changes,
edit the page file; this index is rebuilt from those files, so a gap struck
through there disappears from the table above on the next rebuild.

_Last regenerated 30 Aug 2026._
