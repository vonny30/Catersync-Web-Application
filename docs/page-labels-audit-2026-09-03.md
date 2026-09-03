# Page-by-page label review — 3 Sep 2026

Every string a manager can read, extracted from all 47 page, component and
layout files — headings, tab names, card labels, column headers, buttons,
field labels, placeholders, filter chips, modal titles and empty states — then
read page by page and asked one question: *does this word mean, to someone who
runs a catering business, what the screen is actually showing?*

This is the companion to `terminology-audit-2026-09-03.md`. That one checked
words against the glossary. This one checks them against the **pages**, which
turns up a different and larger class of problem: **the same idea called two
different things on two different screens** — or, six times, on the same screen.

Nineteen findings. None is a bug; all are one-line string edits. They are
ordered by how likely a panelist is to see them.

---

## A. The same thing, two names

These are the ones that cost marks, because a panelist reading two screens
side by side sees the system contradict itself.

### A1. `booking ref` vs `reference` — 8 places, the largest single inconsistency
The glossary settled on **Reference**, and two screens already say it:
`Bookings.jsx:1293` and `Payments.jsx` both use *"Customer name or reference"*.
Eight search boxes still say *"booking ref"*:

| Page | Line | Placeholder |
|---|---|---|
| Equipment | 2617 | `Search by customer, booking ref, venue, or equipment...` |
| Equipment | 2773 | `Search by equipment, customer, booking ref, or venue...` |
| Equipment | 3387 | `Search by customer name or booking ref...` |
| Payments | 2052 | `Search by customer name or booking ref...` |
| Payments | 2104 | `Type to search by customer name or booking ref (e.g. …)` |
| Reports · DetailModal | 99 | `Search by customer or booking ref...` |
| Vehicles | 1739 | `Search by customer, booking ref, venue, or plate...` |
| Vehicles | 1924 | `Search by plate, customer, booking ref, or venue...` |
| Vehicles | 2534 | `Search by customer name or booking ref...` |

→ `booking ref` → **reference** in all eight.

### A2. `Guests per Unit` vs `Pax per Unit` — on one page
`Equipment.jsx:2481` column header says **Guests per Unit** (the settled term).
`Equipment.jsx:3160` and `:3243` — the Add and Edit forms for the very same
field — say **Pax per Unit**.

A manager fills in "Pax per Unit" and then reads the column as "Guests per
Unit" and has to work out they're the same number.

→ both forms → **Guests per Unit**.

### A3. `Free` vs `Available` — on one tab
`Reports/EquipmentUtilizationTab.jsx` uses **Available** at `:27` and for its
"Available Equipment" panel, then **Free** at `:44`, `:52`, `:102` and `:119`
("Free Now", column header "Free", detail field "Free now").

The glossary retired *Free* explicitly: one word for one idea, because readers
never reliably inferred which of the two was which.

→ `Free` / `Free Now` / `Free now` → **Available** / **Available now**.

### A4. `Maintenance` vs `Under Maintenance` — on one page
`vehicle_status` stores the string `Maintenance`. Vehicles renders it three
different ways:

- `:895` maps it correctly to `RESOURCE_STATE.underMaintenance` → **Under Maintenance**
- `:2114` renders `{v.vehicle_status}` **raw** → **Maintenance**
- `:2446`, `:2492` — the dropdown options are labelled **Maintenance**

Equipment says **Under Maintenance** throughout. Same fleet, same condition,
two words on one page.

→ `:2114` should go through the same map as `:895`; the two `<option>` labels
should read **Under Maintenance** while still writing the stored value
`Maintenance` — exactly the pattern `statusLabels.js` was written for.

### A5. `Order` alone vs `Short Order`
`ShortOrderDetails.jsx:474` gets it right: **"Delete Short Order?"**. The list
page doesn't:

| Line | Text |
|---|---|
| `ShortOrders.jsx:836` | `⚠️ Duplicate Order Found` |
| `ShortOrders.jsx:847` | `⚠️ Duplicate Order Detected` |
| `ShortOrders.jsx:1055` | `Delete Order?` |
| `ShortOrders.jsx:1106` | `Delete Selected Orders?` |

"Order" on its own is the one word the glossary is most careful about, because
**Short Order** is a specific product and "Orders" is also the tempting umbrella
for both products.

→ all four → **Short Order** / **Short Orders**.

### A6. `Other Fees` — one field, two explanations
Three screens say **"Other Fees (add-ons, extra services)"**; three say
**"Other Fees (add-ons)"**. Same column, same money.

→ pick one. **"Other Fees (add-ons, extra services)"** is the more useful gloss.

> **This also corrects `finishing-plan.md` §3, Doc 2.** It says UFR-MA-08's
> "add-on services" has *"no table, no column, no UI"*. The first two are right;
> the third isn't — this label is the UI, and it's on six screens. The
> requirement is better reworded to point at this field than dropped outright.

### A7. `Title` vs `Name` for the thing being sold
`ItemFormModal.jsx:135` **Menu Title**, `:149` **Package Title** —
`Equipment.jsx:3087` and `:3209` **Equipment Name**.

A dish has a name. "Title" belongs to documents.

→ **Menu Item Name**, **Package Name**.

### A8. `Paid to Date` vs `Payments Received`
`FinancialTab.jsx:72` and `OverviewTab.jsx:54` say **Paid to Date**. The
glossary settled **Payments Received** (replacing "Net Collected"), so this is
a third name for cash in.

→ **Payments Received**, matching the glossary and the Payments page.

### A9. `Pending Verification` vs `Awaiting Verification` — on one page
`Payments.jsx:1132` — the red summary card — correctly reads **Awaiting
Verification**. `Payments.jsx:311` sets the tab label to **Pending
Verification**, the raw stored value.

Worse than a mismatch: `booking_status` also has **Pending**, so the tab and
the booking status now share a word for two unrelated things.

→ tab `label` → **Awaiting Verification**. Leave `key` on the stored value.

### A10. Casing drift inside Payments
`Verify Payment` / `Verify payment`, and `Reject Payment Proof` / `Reject Proof`
/ `Reject proof` — three names for one action, two casings for another, all in
one file.

→ **Verify payment** and **Reject proof** everywhere, or pick the Title Case
forms — either is fine, but not both.

### A11. `Date Created` vs `Created`
Bookings and Short Orders use both for the same column.

→ **Date created** in the header, **Created** nowhere else, or vice versa.

---

## B. Wrong noun for what the screen shows

### B1. `Fleet Utilization` on the Equipment tab
`Reports/EquipmentUtilizationTab.jsx:23` titles the drill-down **"Fleet
Utilization"**. A fleet is vehicles. This panel is chairs and tables, and the
Vehicles tab next to it uses "Fleet Size" and "Fleet Status" for the actual
fleet.

→ **Equipment Utilization**.

### B2. `Financial & Reports` as the Reports page title
`Reports/index.jsx:690`. **Financial** is one of the five tabs *inside* this
page — Overview, Financial, Menu Performance, Equipment, Vehicles. The title
names a part and the whole as if they were siblings, and the sidebar just says
**Reports**.

→ **Reports**.

### B3. `Packages & Menu` vs the sidebar's `Packages & Menus`
`PackagesAndMenus/index.jsx:1136` is singular; `ManagerLayout.jsx:128` is
plural; the tab inside is **Menu Items**. Clicking a nav item should land on a
page with the same name.

→ **Packages & Menus**.

### B4. `Vehicle Fleet Status`
`Reports/VehicleUtilizationTab.jsx:96`. A fleet is already vehicles.

→ **Fleet Status**.

### B5. `Tail`
`Reports/MenuPerformanceTab.jsx:155` badges low-ranking items **"Tail"** — from
"long tail". That is a statistics word shown to someone who sells food.

→ **Low** — or drop the badge; the share column already says it.

---

## C. Smaller things, still worth the minute

| # | Where | Now | Suggested |
|---|---|---|---|
| C1 | `ItemFormModal.jsx:472` | `Min Pax. *` | `Min Pax *` — stray full stop |
| C2 | `ItemFormModal.jsx` tab | `Basic Info` | `Details` — "Info" is the only abbreviation of its kind in the app |
| C3 | `Vehicles.jsx` | `Base Status` / `Base status` | `Vehicle status` — "base" reads as the depot, not as "the vehicle's own status" |
| C4 | `Payments.jsx:522` | `+ Record Payment` | `Add Payment` or plain `Record Payment` — every other add button in the app is `Add New …` with no `+` in the text |
| C5 | `Dashboard.jsx:297` | `Good day, PG's Catering Manager` | The app knows the signed-in manager's first name (Settings stores it). `Good day, Vaughn` is warmer and is the first line on the first screen |

---

## D. Checked and correct — leave these alone

Worth stating, because these are the ones most likely to be "fixed" by mistake:

- **Equipment's status vocabulary** — Owned · Usable · Available · Committed to ·
  In Use · Under Maintenance · Damaged · Overdue · Low stock · Fully committed ·
  None usable · Good condition. Consistent, plain, and correct throughout.
- **Vehicles' dispatch vocabulary** — Assigned · In Use · Returned · Awaiting
  Vehicle · Trips booked · Fleet · Overdue · Unavailable. Matches
  `statusLabels.js` and the dispatch model.
- **Money vocabulary** — Contract Value · Revenue Earned · Outstanding Balance ·
  Downpayment · Fully Paid · Refunds · Remaining. All glossary-conformant.
- **Pax vs guests** — "Pax" in columns and forms, "guests" in sentences
  (`Extra Pax (additional guests)`), exactly as the glossary specifies.
- **Reports' share language** — Share of Revenue · Share of Bookings · Share of
  Trays, each with a sentence saying what the denominator is. This is the part
  of the app that reads best.
- **Trays** as the unit for short orders, everywhere.
- **`Confirm This Event?` on Bookings vs `Confirm This Order?` on Short Orders** —
  differs by type on purpose. Correct.

---

## E. Order of work

If you only do part of this, do it in this order:

1. **A1** (8 placeholders) — highest count, lowest risk, pure find-and-replace.
2. **A2, A3, A4, A5, A9** — the five self-contradictions, where one screen
   already disagrees with itself.
3. **B1, B2, B3** — the three page and panel titles a panelist reads first.
4. Everything else.

All of §A and §B are string literals. Nothing here touches a stored value, a
query, or a calculation — **A4** and **A9** are the only two that go near one,
and both keep the stored string and change only what is rendered.
