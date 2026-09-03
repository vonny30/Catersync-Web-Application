# Terminology audit — 3 Sep 2026

Every user-visible noun and business term in `src/`, checked against the glossary
in `docs/blueprint-02-language.md` §3 and the display-label rules in
`src/utils/statusLabels.js`.

**Result: the vocabulary is in good shape.** Of the terms the glossary retired,
none survives in a live label except the seven groups below. Everything the
glossary settled — Contract Value, Revenue Earned, Revenue Share, Committed,
In Use, Under Maintenance, Reference, Downpayment, Outstanding Balance,
Payments Received, Guests per Unit, Quick filters, Motif Color — is used
correctly and consistently, with zero occurrences of their banned aliases in
anything a manager reads.

Seven items are real. Three are judgment calls. One is a stale comment sitting
on top of a trap that has already caused a regression once.

---

## 1. Real violations — user-visible

### 1.1 `Catersync` — the brand, wrong capitalisation
`src/pages/ResetPassword.jsx:109` (image `alt`), `:111` (`<h1>`)

Thirteen other brand instances across `ManagerLayout`, `Login` and
`ForgotPassword` all read **CaterSync**. Reset Password is the only screen that
was missed in the original sweep, and it is a page a panelist may well open.

→ `Catersync` → **CaterSync**, both lines.

### 1.2 `Client` — banned alias for Customer
Glossary: *"If it's a Customer on the form it isn't a Client in the table."*

| File:line | Text |
|---|---|
| `hooks/useCancellationHandlers.js:127` | `Client cancelled ${n} day(s) before the event…` |
| `hooks/useCancellationHandlers.js:129` | `Client cancelled – no refund processed.` |
| `pages/Bookings.jsx:1271` | `Manage all client catering reservations (package bookings only)` |
| `pages/BookingDetails.jsx:2432` | placeholder `…client requested cancellation…` |
| `pages/Bookings.jsx:2327` | same placeholder |
| `pages/Dashboard.jsx:1460` | same placeholder |
| `pages/ShortOrderDetails.jsx:1876` | same placeholder |
| `pages/ShortOrders.jsx:2226` | same placeholder |

The first two matter most: they are **written into `booking.notes`** and stored
permanently, so they outlive any later relabelling. The Bookings subtitle
carries a second violation — *reservations* is also a retired alias for
**Booking**.

→ `Client` → **Customer** everywhere; Bookings.jsx:1271 → *"Manage all customer
catering bookings (package bookings only)"*.

`Payments.jsx` uses `'client'` as an internal sort key while rendering the
header as **Customer** (`:1336`). That is correct and needs no change.

### 1.3 `Deployed` — banned alias for In Use / Committed
Glossary: *Committed* replaces *Deployed*; equipment that is out is **In Use**.

| File:line | Text |
|---|---|
| `pages/Reports/OverviewTab.jsx:104` | `${n} of ${m} units deployed` |
| `pages/Reports/OverviewTab.jsx:111` | detail field label `'Deployed'` |
| `pages/Reports/EquipmentUtilizationTab.jsx:42` | `…in good condition and not deployed to a booking.` |
| `pages/Reports/EquipmentUtilizationTab.jsx:114` | `…(currently deployed, not yet returned).` |

The visible chart labels in `EquipmentUtilizationTab` were already corrected to
**In use** — only the drill-down descriptions were missed. On `OverviewTab` the
card is titled **"Equipment In Use"** and its own sub-line then says
*"deployed"*: two words for one number, six pixels apart.

→ `deployed` → **in use**; the `'Deployed'` field label → **In use**.
Internal identifiers (`totalDeployed`, `deployedMap`, `e.deployed`) are not
user-visible and should stay as they are — renaming them is churn with a
regression risk and no reader benefit.

### 1.4 `Allocated` / `Allocation` — banned alias for Assigned
| File:line | Text |
|---|---|
| `pages/Equipment.jsx:3594` | column header `Allocated` |
| `components/ApprovalAvailabilityCheck.jsx:293` | panel title `Equipment Allocation` |
| `pages/BookingDetails.jsx:1700` | panel title `Equipment Allocation` |

The Equipment one is the clearest: the header row reads **Needs / Allocated /
Missing**, while the sentence directly above it in the same panel
(`Equipment.jsx:3582`) says *"Everything for this event has to be **assigned**
here."* One panel, two words, one idea.

→ column header → **Assigned**; panel titles → **Equipment Assigned**.

### 1.5 `Scheduled` on assignment badges — retired label, and a missing state
`pages/BookingDetails.jsx:1818`, `pages/ShortOrderDetails.jsx:1380`

```jsx
{returned ? 'Returned' : 'Scheduled'}
```

`utils/statusLabels.js` exists precisely to stop this. Its header explains why
*Scheduled → Completed* was retired: `booking_status` also has a value called
**Completed**, so a manager reading "Completed" on a vehicle row was reading one
word for *"the van came back"* and *"the wedding happened"*.

This is not only a wrong word. The hand-rolled badge has **two** states where
the lifecycle has three, so during the event itself the booking page says
*Scheduled* while the Vehicles page says *In Use* for the same assignment.

→ replace both with the shared helper:

```jsx
{getAssignmentStatus(returned, booking?.event_datetime).label}
```

importing `getAssignmentStatus` from `../utils/statusLabels`. The existing
two-tone colour can stay — `returned` still drives it correctly.

### 1.6 `Pending Orders` — "Orders" used as the umbrella
`pages/Dashboard.jsx:566`, `:776`, `:910`

Glossary: **Short Order** is a specific product, so *Orders* alone must not mean
both. **Bookings & Orders** is the settled umbrella.

The card counts both, and the tell is right underneath it — a caption reading
*"(Packages + Short Orders)"*, added to undo the impression the heading creates.
The modal title `Pending Orders (All Types)` does the same job twice.

→ **Pending Bookings & Orders**; drop the now-redundant caption, and the modal
title becomes plain **Pending Bookings & Orders**.

### 1.7 `Order Details` over a panel that shows both types
`pages/Payments.jsx:2119`

The record picker above it badges each row **Package** or **Short Order**
(`:2081-2083`), so this heading sits over package bookings too. The JSX comment
one line above already says `{/* Booking Details Preview */}`.

→ make it follow the record:

```jsx
{selectedBooking.booking_type === 'Short Order' ? 'Order Details' : 'Booking Details'}
```

The two `Order Details` headings in `ShortOrderDetails.jsx` (`:1003`, `:1628`)
are correct — that page only ever shows short orders.

---

## 2. Judgment calls — flagged, not violations

**`Product Line`** — `Reports/MenuPerformanceTab.jsx:75`, `:85`. Correct English
and used consistently, but it is manufacturing/enterprise register for a
business whose two "lines" are packages and food trays. *"Revenue by Product
Line"* → *"Packages vs Short Orders"* would read closer to how PG's talks. Not
in the glossary either way; safe to leave.

**`Vehicle Fleet Status`** — `Reports/VehicleUtilizationTab.jsx:96`. A fleet is
already vehicles. **Fleet Status** is shorter and says the same thing.

**Stored values named in tooltips** — `Reports/OverviewTab.jsx:123`
(*"assignments currently marked Scheduled"*) and
`Reports/VehicleUtilizationTab.jsx:118` (*"vehicle_assign table (Scheduled
assignments)"*). These describe the data source verbatim, which is what those
drill-downs are for, so naming the stored value is defensible. It does surface a
word the interface otherwise retired. Leave, or reword to *"assignments not yet
returned"* if you want the retired word gone from the screen entirely.

---

## 3. Stale comment on a known trap

`pages/Vehicles.jsx:110`

```js
useState('All'); // 'All' | 'Scheduled' | 'In Use' | 'Completed'
```

The buttons at `:1931` actually render `['All', 'Assigned', 'In Use',
'Returned']`, and the filter at `:1104` maps those display labels to
`getAssignmentStatus` keys. The comment describes the **stored** values instead.

The block at `:1097-1103` warns in as many words that mapping this to
`'scheduled'/'completed'` *"matches nothing at all and silently empties the
table for two of the three filters"*, and that it **has already regressed once**
via a stale-copy overwrite. A comment that states the wrong list, directly above
that warning, is how it regresses a second time.

→ `// 'All' | 'Assigned' | 'In Use' | 'Returned' — display labels, not stored values`

---

## 4. Verified clean

No live label anywhere in `src/` contains: `Owner`, `Admin`, `Down payment`,
`Deposit`, `Reservation` (except Bookings.jsx:1271 above), `Booking Ref`,
`Order Ref`, `Ref` alone, `Needs Review`, `Pax/Unit`, `Quick looks`,
`Headcount`, `In repair`, `Free to Use`, `Reserved`, `Total Revenue`,
`Gross Revenue`, `Net Collected`, `Pending Balance`, `Popularity Metric`,
`Full Payment`.

Three of those appear **only inside comments explaining why they were dropped** —
`Payments.jsx:1154`, `BookingSummaryTab.jsx:59`, `Reports/index.jsx:454`. That is
the right place for a retired term: it stops someone reintroducing it.

`Payments.jsx:313` uses `'Full Payment'` as an internal filter key while
rendering the label **Fully Paid**. Not visible; no change needed.

Title Case on field labels, card titles and column headers is used consistently
across all 21 pages and is permitted by the casing rule (proper nouns, stored
status values and column headers are the stated exceptions). No change proposed —
converting ~140 labels to sentence case is a large diff days before a defence,
with a real chance of missing some and ending up *less* consistent than now.

---

## 5. For the mobile developer

The Operations Manager and Main Cook apps show the same resources, so these
labels should match. The two that matter on mobile:

- **Assignment lifecycle:** display **Assigned → In Use → Returned**. The
  database still stores `Scheduled` / `Completed` in
  `vehicle_assign.assignment_status`; never show those strings. Web keeps the
  mapping in `src/utils/statusLabels.js` — mirror that function rather than
  re-deriving it.
- **Availability:** **Available / Committed / Under Maintenance / Unavailable**.
  Not *Deployed*, not *Free*, not *Reserved*.

Both are already recorded in `docs/ops-manager-sync.md` §0.1; this audit found no
drift between them and the web code.

---

## 6. Revert

All seven fixes in §1 are single-line string edits except §1.5, which adds one
import and swaps one expression per file. Reverting any of them is replacing the
new string with the old one listed in the tables above. No schema, no stored
data, no logic touched — §1.5 changes which of three labels a badge shows, and
nothing reads that label back.
