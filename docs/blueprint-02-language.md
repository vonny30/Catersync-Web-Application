# Blueprint 02 — Language & metrics

What the system says, and what it actually means. Drafted 21 Aug 2026.
Scope: all 12 screens + Reports. Changes are copy and calculations only; schema
untouched.

Rendered version: https://claude.ai/code/artifact/b4b594c9-b790-422a-9199-c1cc2c92420a

**Status: §9 steps 1–5 are done and committed. Only step 6 (the remaining
screen sweep in §6) is still a proposal.**

---

## 1. The problem, in three labels

| The label | What it actually is | Where |
|---|---|---|
| **Quick looks** | Two buttons that apply saved filters. "Looks" isn't a noun for views, and it's the only sentence-case label in a row of Title Case ones. | `Bookings.jsx:1230`, `ShortOrders.jsx:1143` |
| **Popularity Metric** | Revenue, not popularity. An item ordered 90 times can rank near the bottom. | `MenuPerformanceTab.jsx:24` |
| **Pending Balance** | The unpaid balance on *all* active records. Nothing to do with the booking status called Pending. | `Payments.jsx:1051` |

Roughly ninety more follow the same pattern.

### Settled decisions

| Question | Decided | Consequence |
|---|---|---|
| Role name | **Manager** ✓ | "Welcome back, Owner!" goes. Matches the `manager` table. |
| Deposit term | **Downpayment** ✓ | One word, matches the stored `pay_status`. |
| Umbrella term | **Bookings & Orders** | "Orders" alone stops being an umbrella. |
| Casing | **Sentence case** | Except proper nouns, stored status values, column headers. |

## 2. House rules

1. **Sentence case for labels and sentences. Title Case only for names.** Proper nouns (CaterSync, PG's Catering, GCash), stored status values (Pending, Confirmed, Downpayment) and column headers keep capitals. — *"Max Pax Included must be at least 1." → "Maximum guests included must be at least 1."*
2. **Labels are nouns. Buttons are verbs.** The confirmation reuses the button's word. — *"First Payment?" → "Payment Type"; "Login" → "Sign in"*
3. **One concept, one word — across every screen.** If it's a Customer on the form it isn't a Client in the table. — *"Ref / Booking Ref / Order Ref" → "Reference"*
4. **A number's label must describe its own maths.** If it says popularity, count orders. If it says net, subtract refunds. If it says share, divide by the whole.
5. **Confirmations state what happened. They don't celebrate.** Past tense, full stop, no "successfully", no exclamation mark. — *"Equipment added successfully!" → "Equipment added."*
6. **Errors say what's wrong and what to do next.** — *"Access denied. This login page is restricted to authorized manager accounts only." → "This sign-in page is for managers. Customers should use the CaterSync app."*
7. **No emoji, no asterisk bullets, no vendor names.** Status belongs in the badge components that already exist. The asterisk means "required field" and can't also mean "note". — *"Upload a proof image; will be stored in Supabase Storage." → "PNG or JPG, up to 5 MB."*

## 3. Glossary

A ✓ marks a term already swept through the codebase (step 3, 21 Aug 2026).
Terms without one are either pending a later step or waiting on Blueprint 01.

| Use this | Meaning | Stop using |
|---|---|---|
| **CaterSync** ✓ | The product. Capital S. | Catersync |
| **Manager** | The person signed into admin. | Owner, Admin |
| **Customer** ✓ | The person paying for the event. | Client |
| **Booking** | A full catering event booked against a package. | Reservation, Package order |
| **Short Order** | A standalone food tray order. | Order (on its own) |
| **Bookings & Orders** | Both products together. | Orders, Records, Items |
| **Reference** ✓ | The human-readable booking/order number. | Ref, Booking Ref, Order Ref |
| **Guests** / **Pax** | Headcount. "Pax" in tight columns and forms; "guests" in sentences. | Headcount |
| **Tray** | The unit a Short Order is sold in. 35–50 guests. | — |
| **Downpayment** | The 50% payment that secures a booking. | Down payment, Deposit |
| **Fully Paid** ✓ | Nothing left owing. Matches `pay_status`. | Full Payment |
| **Awaiting Verification** ✓ | Proof submitted, not yet reviewed. | Needs Review |
| **Payments Received** | Cash in, net of refunds, by payment date. | Net Collected |
| **Outstanding Balance** | Contract value not yet paid. | Pending Balance |
| **Contract Value** | What a booking is worth in total. | Total Revenue |
| **Revenue Earned** | Contract value of delivered (Completed) events. | Gross Revenue |
| **Revenue Share** | One item's revenue as a share of its group's total. Sums to 100%. | Popularity Metric, Performance |
| **Assigned** ✓ | Reserved for a future event. | Scheduled (vehicles), Allocated |
| **In Use** ✓ | Event happening; item is out. | — |
| **Returned** ✓ | Back in stock or at the garage. | Completed (vehicles) |
| **Committed** ✓ | Promised to a booking on a date, not yet out. | Deployed, Reserved |
| **Available** ✓ | Not committed — on the date being viewed, or right now. The surrounding label carries the scope ("Available" under a date picker, "Available now" on a live panel). | Free, Deployed |
| **Under Maintenance** ✓ | Set aside for repair. | In repair, Damaged / in repair |
| **Damaged** | Broken, awaiting a decision. | — |
| **Guests per Unit** ✓ | How many guests one unit serves. | Pax/Unit |
| **Quick filters** ✓ | One-click preset filters above a list. | Quick looks |
| **Motif Color** | The event's colour theme. Correct term — keep. | — |

Where a stored value can't be renamed under the read-only constraint
(`vehicle_assign.assignment_status` stores "Completed" where the glossary says
"Returned"), relabel in the interface and leave the value alone. Put the mapping
in one shared file so it can't drift.

## 4. Percentages that lie — **FIXED, shipped 21 Aug 2026**

### What was wrong with Menu Performance

| # | Fault | Where |
|---|---|---|
| 1 | **Packages and menu items ranked in one list.** A package at ₱1,200 × 80 guests placed in the same ranking as one ₱1,200 tray. Not the same kind of quantity. | `index.jsx:270-273` |
| 2 | **The percentage was share of the biggest, not share of the whole.** `revenue ÷ maxRevenue × 100` — the top row *always* read exactly 100%. The bars added to nothing. | `index.jsx:275-280` |
| 3 | **A column headed "Popularity" that measured money.** A ₱200 tray sold 90 times is the most popular item and sat near the bottom. | `MenuPerformanceTab.jsx:24,42` |
| 4 | **Every menu item rendered red.** Threshold `revenue < maxRevenue × 0.1`, where `maxRevenue` came from the merged list — a package's revenue. | `index.jsx:284`, `MenuPerformanceTab.jsx:59` |
| 5 | **Category bars were share-of-max on a double-counted base.** A booking counted once for every category its package includes, so values summed to far more than the number of bookings while drawn as shares of it. | `index.jsx:296-304`, `MenuPerformanceTab.jsx:99` |
| 6 | **Menu item revenue restated at today's prices.** `menu_selections` stores only `{menu_item_id, quantity}` — no price snapshot — so raising a price silently rewrote past revenue, and item revenues couldn't sum to the order's `total_amount`. | `index.jsx:257-267` |

### The rule

> A percentage is only meaningful when the things compared are the same kind of
> thing, **and** the parts add up to the whole.

```
wrong   share = this item's revenue ÷ biggest item's revenue
        → top row always 100%, column sums to nothing

right   share = this item's revenue ÷ total revenue of its own group
        → column sums to exactly 100%
```

### What shipped

`src/pages/Reports/` — `index.jsx`, `MenuPerformanceTab.jsx`, `OverviewTab.jsx`,
`helpers.js`.

The derivation now produces four independent mixes:

- **`productLineMix`** — packages vs short orders, two rows, sums to 100%. The
  only place the two belong together.
- **`packageMix`** — each package ÷ total package revenue. Columns: bookings,
  share of bookings, revenue, share of revenue, `cumulativeShare`, average value
  per booking. The row where cumulative first reaches 80% is marked.
- **`menuItemMix`** — each item ÷ total menu item revenue, with trays sold and
  share of trays beside it. `topSellingItem` is tracked separately, because the
  most-ordered item and the highest-earning item are usually different — the
  question one "Popularity" column could never answer.
- **`categoryDemandData`** — divided by **total package bookings**, a real
  denominator. A category in every booking reads 100%. The shares intentionally
  total more than 100% because one package spans several categories, and the
  panel says so.

Supporting changes:

- `withShares(rows, totalRevenue, totalCount, countKey)` in `index.jsx` attaches
  `revenueShare`, `countShare` and `cumulativeShare`. `countKey` is bookings for
  packages, trays for menu items.
- **Fault 6 workaround:** each Short Order's food revenue
  (`total_amount − delivery_fee`) is allocated across its lines in proportion to
  price × quantity. Item revenues now sum to money actually received, and any
  approval-time fee adjustment rides along. `delivery_fee` was added to the
  booking SELECT. `hasEstimatedMenuRevenue` flags orders with nothing priced to
  allocate against, and the tab says so when it's set.
- The tab footer prints the reconciliation — menu items + delivery fees = short
  order revenue — so panels 1 and 3 can be checked against each other.
- Tab renamed "Menu Performance" → "Menu & Packages".
- Overview's "Top Performer" card became **"Top Sellers"**, showing the top
  package and top menu item separately with their real shares.
- `formatPercent` added to `helpers.js` — one decimal place, so a column visibly
  totals 100.0% instead of 99% or 101%.

Verified by slicing the real derivation out of `index.jsx` and running it against
synthetic data: 25 checks passing, covering share sums, cumulative monotonicity,
the delivery-fee reconciliation, empty periods, malformed `menu_selections` JSON,
items deleted from the menu, and packages-only periods.

### Still open

**Vehicles — Available card** (`VehicleUtilizationTab.jsx:7,49`).
`available = total − dispatched`, so a van flagged Maintenance or Unavailable and
not dispatched is counted as "Available · Free for a new dispatch". Subtract
Maintenance and Unavailable too, and show them as their own figure.

## 5. Status vocabulary — **DONE, shipped 21 Aug 2026**

Implemented as `src/utils/statusLabels.js`, imported by both Equipment and
Vehicles. It exports `getAssignmentStatus(isFinished, eventDatetimeStr)` plus
`ASSIGNMENT_STAGES` and `RESOURCE_STATE`. The two pages' local copies of the
lifecycle function are gone; 8 call sites now share one implementation.

The module takes a **boolean** for the finished state, never a stored string —
so no database value reaches it and `vehicle_assign.assignment_status` keeps its
'Scheduled'/'Completed' values exactly as they are. Vehicles derives the boolean
at its call site with `a.assignment_status === 'Completed'`.

Also centralised there: `RESOURCE_STATE`, which is where Vehicles' availability
labels now come from — Deployed → **Committed**, Maintenance → **Under
Maintenance** — while the `v.vehicle_status === '…'` comparisons are untouched.

Behaviour was checked against verbatim re-implementations of both original
functions across all 8 input combinations (finished × future/past/missing date):
identical to Equipment's in every case, same stage as Vehicles' in every case,
with only the label renamed.

| Stage | Equipment says | Vehicles say | Use | Stored value |
|---|---|---|---|---|
| Reserved for a future event | Assigned | ~~Scheduled~~ | **Assigned** | unchanged |
| Event happening, item is out | In Use | In Use | **In Use** | unchanged |
| Back in stock / at base | Returned | ~~Completed~~ | **Returned** | unchanged |

`booking_status` also has a value called Completed meaning something entirely
different — the event was delivered. A manager reading "Completed" on a vehicle
row is reading one word for "the van came back" and "the wedding happened."
Relabel the display; leave `vehicle_assign.assignment_status` alone.

Put the mapping in a shared `statusLabels.js` that both screens import.

**Free vs Available — resolved 21 Aug 2026 in favour of one word.** The split
was tried and dropped: readers never inferred which word meant which, and two
words for one idea cost more than the distinction was worth. **Available** is
now the only term, with the surrounding label carrying the scope. `RESOURCE_STATE`
in `utils/statusLabels.js` no longer defines `free`.

## 6. Screen by screen

### Login — `pages/Login.jsx`
| Line | Now → Proposed | Why |
|---|---|---|
| 165 | `Catersync` → **CaterSync** | Product name misspelled on the first screen anyone sees. |
| 171 | `Welcome back, Owner!` → **Welcome back** | The sidebar calls the same person Manager. |
| 172 | `Sign-in to your account` → **Sign in to your account** | Hyphenated is a noun; as an instruction it's two words. |
| 176 | `Login` → **Sign in** | Button matches the verb in the heading. |
| 261 | `@2023 all rights reserved` → **© 2026 PG's Catering. All rights reserved.** | Wrong symbol, three years stale, no capitals, no full stop. |
| 39 | `Welcome back!` → *remove* | The page it lands on already says it. |
| 130 | `Access denied. This login page is restricted to authorized manager accounts only.` → **This sign-in page is for managers. Customers should use the CaterSync app.** | Rule 6. |

### Sidebar — `layouts/ManagerLayout.jsx`
| Line | Now → Proposed |
|---|---|
| 233 | `Catersync` → **CaterSync** |
| 140 | `Failed to log out` → **Couldn't sign out. Please try again.** |

### Dashboard — `pages/Dashboard.jsx`
| Line | Now → Proposed | Why |
|---|---|---|
| 672-673 | `Pending Orders / (Packages + Short Orders)` → **Pending Approval / Bookings & orders awaiting a decision** | "Orders" as umbrella; the parenthetical reads like a dev note. |
| 705 | `Net Collected This Month` → **Payments Received This Month** | **DONE.** Still doesn't match the Reports figure — Blueprint 01 Phase 1 fixes that. |
| 688 | `Upcoming Events (7 days)` → **Upcoming Events · Next 7 Days** | |
| 1014 | `Ref` → **Reference** | Three spellings across the app. |
| 1147 | `Total Net Collected:` → **Total received:** | |
| 1288-1289 | `Down payment (50%): · * Down payment is required…` → **Downpayment (50%): · Downpayment is required to secure the order. Non-refundable within 3 days of the event.** | Spelling; the asterisk already means "required field" on this modal. |
| 971 | `Refund` in the payment-method list → *move to a transaction-type filter* | A refund isn't a payment method. Same at `Payments.jsx:1172`. |
| 1004 / 1006 | `No records found for this category. · No records match your search/filter.` → **Nothing here yet. · No results. Try changing your search or filters.** | Two empty states, two voices. |
| 1341, 1372 | `(optional – leave blank to skip) · (required if amount entered)` → **Optional · Required if you enter an amount** | |

### Bookings — `pages/Bookings.jsx`
| Line | Now → Proposed | Why |
|---|---|---|
| 1197 | `Manage all client catering reservations (package bookings only)` → **Full catering events booked against a package.** | |
| 1230 | `Quick looks` → **Quick filters** | The handler is literally `applyTodayFilter`. |
| 1390 | `Client` → **Customer** | The filter above this table says Customer. |
| 1293 | `Client name or booking ref...` → **Customer name or reference** | |
| 2067-2068 | `Down payment` → **Downpayment**, asterisk removed | |
| 1944 | `⚠️ Custom color – consider adding it to the package.` → **Not in this package's colour list.** as a badge | Rule 7. |
| 1951 | `Total Amount (auto-calculated)` → **Total Amount** + hint "Calculated automatically" | |
| 1865 | Keep — capitalise to **PG's Catering policy** | |

### Short Orders — `pages/ShortOrders.jsx`
| Line | Now → Proposed |
|---|---|
| 1110 | `Manage food tray orders (pickup/delivery) – each tray serves 35‑50 pax` → **Food tray orders for pickup or delivery. Each tray serves 35–50 guests.** |
| 1143 | `Quick looks` → **Quick filters** |
| 1288 | `Client` → **Customer** |
| 1872 | `* Down payment may be required for large orders (subject to business policy).` → **Downpayment may be required for large orders.** |
| 1727 | `Choose item...` → **Select a menu item** |
| 1800 | `Auto-calculated from menu items × quantity + delivery fee.` → **Menu items × quantity, plus the delivery fee.** |

### Payments — `pages/Payments.jsx`
| Line | Now → Proposed | Why |
|---|---|---|
| 1051-1053 | `Pending Balance / Outstanding from active orders` → **Outstanding Balance / Unpaid balance on active bookings & orders** | **DONE.** "Pending" is a booking status; this figure had nothing to do with it. |
| 1032 | `Needs Review` → **Awaiting Verification** | Matches the `pay_status` it counts. |
| 1042-1044 | `Net Collected / After refunds (active orders only)` → **Payments Received / Net of refunds · active bookings & orders** | **DONE** |
| 1060-1062 | `Fully Paid / Active orders fully paid` → **Paid in Full / Bookings & orders settled in full** | The card counts *records*; "Fully Paid" is a *payment status*. |
| 264 | `Full Payment` → **Fully Paid** | A third name for the same status, in the same file. |
| 1204 | `Order Ref` → **Reference** | This column holds booking references too. |
| 1149 | `Type` → **Booking Type** | |
| 1172 | `Refund` in Method list → *move to transaction-type filter* | |
| 1817 | `First Payment?` → *remove* | The Payment Status field below already carries it. |
| 1435 | `Other payments for this order` → **Payment history** | The record may be a booking. |
| 1890 | Keep — the model for validation copy | States the rule and the reason. |

### Equipment — `pages/Equipment.jsx`
| Line | Now → Proposed | Why |
|---|---|---|
| 1057 | `Almost full` → **Low stock** | **DONE.** Said the opposite of what it meant. |
| 1055 | `Overbooked!` → **Short by {n}** | **DONE.** Now names the shortfall. |
| 1056 | `None left` → **Fully committed** | **DONE** |
| 1450, 1567 | `Damaged / in repair · In repair` → **Damaged · Under Maintenance** | Two separate DB columns merged in one place, split under a third name in another. |
| 1451 | `Used today` → **In use on this date** | **DONE** |
| 1569 | `Pax/Unit` → **Guests per Unit** | |
| 1570 | `Usage` → **Times Used** | |
| 1248 | `See what's actually free on a given date…` → **Check availability for any date, manage inventory, and track assignments.** | "Actually" implies something else is lying. |
| 2258 | `(how many guests can each unit serve?)` → **How many guests one unit serves.** | |
| 2139 | Keep | Honest about its own uncertainty. |

### Vehicles — `pages/Vehicles.jsx`
| Line | Now → Proposed |
|---|---|
| 1245 | `Base status` → **Fleet Status** |
| 1917 | `Base status overrides auto-status when set to Maintenance or Unavailable.` → **Setting a vehicle to Maintenance or Unavailable overrides its automatic status.** |
| 1246 | `Usage` → **Times Used** |
| 1022 | `Vehicles deployed` → **In use on this date** |
| 571 | `Vehicle removed successfully.` → **Vehicle deleted.** |
| 951 | `See what's actually free on a given date…` → **Check availability for any date, manage the fleet, and track assignments.** |
| — | Assignment status `Scheduled → In Use → Completed` → **Assigned → In Use → Returned** (display only) |

### Packages & Menu — `pages/PackagesAndMenus/index.jsx`
| Line | Now → Proposed |
|---|---|
| 1242 | `Individual Menu Items (Short Orders)` → **Menu Items** |
| 1212 | `Catering Packages` → **Packages** |
| 1117 | `Archived` → **Archived Items** |
| 403, 496 | `… title is required.` → **… name is required.** (the fields say Name) |
| 435 | `Max Pax Included must be at least 1.` → **Maximum guests included must be at least 1.** |

### Reports — `pages/Reports/`
| Where | Now → Proposed | Status |
|---|---|---|
| `index.jsx:424` | `Financial & Reports` → **Reports** | open |
| `MenuPerformanceTab` | merged table → **Package Mix** + **Menu Item Mix** | done |
| `MenuPerformanceTab:24` | `Popularity Metric` → **Revenue Share** + **Share of Trays** | done |
| `MenuPerformanceTab:77` | `Category Popularity` → **Category Demand** | done |
| `BookingSummaryTab:20` | `Accounting Month` → **Event Month** | done |
| `BookingSummaryTab:22` | `Gross Revenue` → **Revenue Earned** | done |
| `BookingSummaryTab:10` | `Historical Booking Summary – Completed Events Only` → **Completed Events by Month** | open |
| Overview / Financial | `Total Revenue · Collected · Outstanding` → **Contract Value · Payments Received · Outstanding Balance** | open — lands with Blueprint 01 Phase 1 |

### Settings — `pages/SettingsPage.jsx`
| Line | Now → Proposed |
|---|---|
| 256 / 306 | `Business Profile` (tab) vs `Manager Profile` (heading) → **Profile** / **Manager Profile** |
| 276 | `Manage your business profile and security.` → **Your profile and sign-in security.** |
| 437 | `Ensure your account is using a long, random password to stay secure.` → **Use a long password you don't use anywhere else.** (lifted from a framework starter kit) |
| 506 | `Passwords don't match yet.` → **Passwords don't match.** |

### Booking Details — `pages/BookingDetails.jsx`
| Line | Now → Proposed |
|---|---|
| 1343 | `Payment Tracking` → **Payment History** |
| 1502 | `Equipment Allocation` → **Assigned Equipment** |
| 1965 | `Upload a proof image; will be stored in Supabase Storage.` → **PNG or JPG, up to 5 MB.** |
| 2089, 2092 | Emoji + shouting caps → plain sentences in the existing badge components |
| 1878 | `First Payment?` → *remove* |
| 1601 | `⚠️ Changing package will re‑allocate equipment…` → **Changing the package reassigns equipment and clears the menu selections.** as a badge |

## 7. Messages — **DONE, shipped 21 Aug 2026**

Applied across 19 files including the shared hooks (`useApprovalHandlers`,
`useCancellationHandlers`, `useCompletionHandlers`, `useConfirmationHandlers`,
`usePaymentHandlers`) and `AuthContext`, not just the pages — several toasts the
manager sees most often live there, not in a screen.

After the pass, **no `toast.success` in the codebase contains "successfully" or
an exclamation mark.** Success-toast counts per file are unchanged except
Login.jsx, which drops from 1 to 0 by design.

Beyond the table below: "logged out" became "signed out" throughout, to match
the Sign in / Sign out verbs settled in §6; `'Order deleted.'` became
`'Short order deleted.'` and the bulk-delete toast now says "short order(s)",
per the glossary rule that "Order" alone is never the umbrella.

Sixteen toasts contain "successfully"; nineteen end in an exclamation mark.

| Now | Proposed |
|---|---|
| Booking created successfully! | Booking created. |
| Booking updated successfully! | Booking saved. |
| Short order created successfully! | Short order created. |
| Equipment added successfully! | Equipment added. |
| Vehicle added successfully! | Vehicle added. |
| Vehicle removed successfully. | Vehicle deleted. |
| Equipment returned successfully! | Equipment returned. |
| Menu item updated successfully! | Menu item saved. |
| Category added! | Category added. |
| Event confirmed! | Booking confirmed. |
| Order confirmed! | Short order confirmed. |
| Booking marked completed. All payments set to Fully Paid. | Booking completed. Remaining payments marked Fully Paid. |
| All items for this event marked as returned. | All equipment for this event returned. |
| Profile updated successfully! | Profile saved. |

"updated" → "saved": the manager pressed Save; the confirmation should use their
word, not the database's.

Errors worth rewriting:

| Now | Proposed | Why |
|---|---|---|
| Please enter a valid pax count (must be at least 1). | Enter the number of guests — at least 1. | "Please" on thirty errors stops being polite. |
| This booking is already fully paid. No additional payments are allowed. | This booking is fully paid — there's no balance left to record against. | Says why, not just no. |
| Damaged and In repair quantities cannot be negative. | Damaged and maintenance quantities can't be negative. | "In repair" isn't in the glossary. |
| Failed to load report data. Please refresh the page. | Couldn't load the reports. Refresh to try again. | "Failed" blames the manager's screen. |
| Please provide a reason so the customer knows what to fix. | **Keep.** | The best error message in the system. |

## 8. Leave alone

- **Pax** — industry standard in catering and in the Philippines. Columns and form labels; "guests" in sentences.
- **Motif Color** — the correct term for an event's colour theme.
- **Tray** — the real selling unit for Short Orders.
- **Walk-in** — a customer booked at the counter.
- **The "where this number comes from" modals in Reports** — extend the habit, don't replace it.
- **"Nothing needs attention right now."** — the best empty state in the system; model the others on it.
- **"Estimated from package (not yet manually assigned)"** — honest about its own uncertainty.

## 9. Order to apply

| Step | What | Status |
|---|---|---|
| 1 | **Menu Performance rebuild** — §4 in full | **done, 21 Aug 2026** |
| 2 | **The labels that mislead** — Pending Balance, Almost full, Overbooked!, None left, Used today, Popularity Metric, Net Collected, Accounting Month, Gross Revenue | **done, 21 Aug 2026** |
| 3 | **Glossary sweep** — §3 terms across all files (64 replacements, 11 files) | **done, 21 Aug 2026** |
| 4 | **Status vocabulary** — the shared `statusLabels.js` from §5 | **done, 21 Aug 2026** |
| 5 | **Messages** — §7, all of it (51 targeted + 3 shared, 19 files) | **done, 21 Aug 2026** |
| 6 | **Screen sweep** — everything remaining in §6, screen by screen | next |

Steps 1 and 2 overlap Blueprint 01: `Net Collected` and `Total Revenue` get their
final names when the shared metrics module lands in its Phase 1. Everything else
here is independent.
