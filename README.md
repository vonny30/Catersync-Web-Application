# CaterSync Admin

The manager's web application for **PG's Catering** (Bayawan City, Negros
Oriental). It runs the business side of every booking: approving requests,
recording payments, assigning equipment and vehicles, and reporting on the
money. Customers book through the separate CaterSync mobile app; both apps
share one Supabase database.

Live: <https://catersync-web-application.vercel.app>

## Technology

| Part | Used for |
|---|---|
| React 19 + React Router 7 | The user interface and page routing |
| Vite 8 | Development server and production build |
| Tailwind CSS 4 | Styling |
| Supabase (PostgreSQL, Auth, Storage, Realtime) | Database, sign-in, uploaded images, live updates |
| Recharts | Report charts |
| html2canvas + jsPDF | The downloadable Booking Details sheet (PNG / PDF) |
| Vercel | Hosting; every push to `main` deploys |

## Running it

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run lint       # code checks
```

Create `frontend/.env` with the Supabase project's details:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Only an account listed in the `manager` table can sign in.

## How the code is organised

```
src/
  main.jsx            entry point
  App.jsx             providers and the route table
  brand.js            the logo (change it here at handover)
  supabase.js         the shared Supabase client
  layouts/            the frame around signed-in pages (top bar, sidebar)
  pages/              one file (or folder) per screen
  components/         pieces shared by several pages (pop-ups, form fields, filters)
  hooks/              the booking actions: approve, reject, confirm, complete,
                      cancel, record and verify payments; live refresh
  contexts/           app-wide state: the signed-in manager, confirm dialogs
  utils/              business rules and helpers (money, equipment, vehicles,
                      dates, formatting)
```

Every file begins with a comment saying what it is for. Pages also name their
route and point to their reference page in `docs/pages/`. A file-by-file list
is in [`docs/SOURCE_INDEX.md`](docs/SOURCE_INDEX.md).

### Where the rules live

The same rule is never written twice; each has one owner that every page uses.

| Rule | File |
|---|---|
| What counts as revenue, cash received and receivable | `utils/reportMetrics.js` |
| What counts as collected money; payment statuses | `utils/payments.js` |
| Booking statuses and their order | `utils/bookingStatus.js` |
| Equipment needed for an event, and stock | `utils/equipment.jsx` |
| Vehicle trips, time windows and dispatch | `utils/vehicle.js` |
| When a booking may be marked Completed | `utils/completion.js` |
| Password rules | `utils/passwordPolicy.js` |

## The booking lifecycle

```
Pending ──approve──> Approved ──50% paid──> Confirmed ──event passed + fully paid──> Completed
   │                                            │
   └──reject──> Rejected                        └──cancel──> Cancelled
```

- **Approve** sets the final price and allocates the package's equipment.
  **Reject** declines a request that has not been confirmed.
- **Confirmed** is reached once at least half is paid and verified; the
  booking's details are then locked.
- **Cancel** calls off a Confirmed booking, with a refund where one is due.
- **Completed** needs both: the event date has passed and the balance is
  settled.

Package bookings and short orders (tray orders) follow the same lifecycle.
Short orders have no equipment.

## Money terms

| Term | Meaning |
|---|---|
| Gross Revenue | The value of Confirmed and Completed bookings in the period |
| Cash Receipts | Money actually received for those bookings, net of refunds, plus forfeited deposits |
| Accounts Receivable | What is still owed on them |
| Total Value | A customer's Confirmed and Completed bookings, all time |

Cash Receipts + Accounts Receivable = Gross Revenue.

## Further documentation

| Document | Contents |
|---|---|
| `docs/pages/` | One page per screen: purpose, rules, tables read and written |
| `docs/HANDOFF.md` | Constraints, conventions, and replacing the logo |
| `docs/ops-manager-sync.md` | The contract with the Operations Manager app |
| `docs/mobile-contract.md` | What the customer mobile app reads and writes |
| `sql/` | Database changes applied to the shared Supabase project |
