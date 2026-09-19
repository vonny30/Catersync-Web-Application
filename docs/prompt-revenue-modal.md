# Prompt for Claude Code — Reports: Short Order badge wrap + Estimated Gross Revenue pending split

There are two separate changes here. Do **both**. Do **not** do anything else —
no refactors, no renames, no touching the Menu, Booking Summary or Overview
tabs beyond the two lines named in Part B.

Files you will touch, and only these:

- `src/pages/Reports/DetailModal.jsx`
- `src/pages/Reports/OverviewTab.jsx`
- `src/pages/Reports/index.jsx`
- `src/pages/Reports/FinancialTab.jsx`

---

## PART A — Fix the wrapping "Short Order" badge (visual bug)

### The bug

In the Reports detail modals, the Type column renders a rounded pill:

```jsx
<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
  {item.type === 'Short Order' ? 'Short Order' : 'Package'}
</span>
```

That span is `display: inline`, has **no `whitespace-nowrap`**, and sits in a
`<td>` that also has no `whitespace-nowrap`. When the column is narrow,
"Short Order" breaks across two lines. Because the element is inline, the
rounded background and the border break with it — the pill renders as two
ragged half-pills stacked on top of each other, with the border running
through the middle of the text. "Package" is one word so it never shows the
defect, which is why this survived.

Reproduce: Reports → Overview → click the **Estimated Gross Revenue** card →
any row whose Type is Short Order (e.g. `SO-041`).

### The fix

This span appears **twice** in `DetailModal.jsx` — at roughly line 186 (the
revenue/collected table) and roughly line 283 (the outstanding table). Fix
**both**. Search for `rounded-full text-xs font-medium` to find them; do not
assume the line numbers are still exact.

For each, add `inline-block whitespace-nowrap` to the span's class list:

```jsx
<span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
```

`inline-block` matters as much as `whitespace-nowrap`: an inline element's
background and border fragment across line boxes, so even a badge that never
wraps its own text will still break if the layout ever forces it. Both
together is what makes a pill structurally a pill.

Also add `whitespace-nowrap` to the two `<td>` wrappers holding those spans,
so the column asks the table for the width it needs rather than compressing.

### Sweep the same defect class

While you are in this file, apply the same `inline-block whitespace-nowrap`
to **every other rounded-full status/type pill in `DetailModal.jsx`** — the
status badges (`Completed` / `Confirmed` / `Approved` / `Pending`) have the
same structure and will break the same way the moment a longer status string
(e.g. `Pending Verification`) reaches them.

Do **not** widen the sweep beyond `DetailModal.jsx` in this task.

### Acceptance for Part A

- Open the Estimated Gross Revenue modal at a narrow window width (~900px).
  The `SO-041` Short Order badge renders as **one unbroken pill on one line**.
- No pill anywhere in that modal shows a border passing through its own text.
- Nothing else in the modal's layout shifts.

---

## PART B — Split committed revenue from un-reviewed enquiries

### The problem, stated precisely

`Estimated Gross Revenue` currently sums **every non-Rejected, non-Cancelled**
booking whose event falls in the period. That includes `Pending` — a request a
customer submitted that PG's has **not yet accepted**.

Against live data for September 2026:

| Status | Bookings | Estimated gross | Verified paid |
|---|---|---|---|
| Completed | 1 | ₱12,500 | ₱12,500 |
| Confirmed | 3 | ₱27,900 | ₱24,000 |
| Approved | 2 | ₱57,500 | ₱0 |
| **Pending** | **2** | **₱35,400** | **₱0** |
| **Total** | **8** | **₱133,300** | **₱36,500** |

**₱35,400 — 27% of the headline figure — is money from requests nobody at PG's
has said yes to yet.** The card discloses this only as "· includes 2 not yet
approved". A count of 2 out of 8 reads as a quarter of the *records*; it gives
no hint that it is more than a quarter of the *pesos*. Those are different
facts and the bigger one is the one not being shown.

This has three consequences that are each independently wrong:

1. **`Unpaid on These Events` tells the manager to chase ₱35,400 from people
   who have not been told yes.** There is nothing to collect on a Pending
   request — by design, `BookingDetails.jsx` will not even open the payment
   panel until the booking is Approved.
2. **`FinancialTab`'s collection rate is deflated by construction.** It prints
   `paidAgainstEvents ÷ contractValue` = ₱36,500 ÷ ₱133,300 = **27.4%**. Against
   accepted work only it is ₱36,500 ÷ ₱97,900 = **37.3%**. The published figure
   divides by a denominator that includes money that could not possibly have
   been collected yet, so the ratio measures partly the approval backlog and
   partly collection performance. It is the same methodological fault as the
   utilization figures that were removed in September.
3. **It contradicts the rule the rest of the app already follows.** Approval is
   this system's commitment boundary everywhere else: approval is what
   allocates equipment (`useApprovalHandlers.js`), the Equipment prep view
   deliberately excludes Pending from shortage counts for exactly this reason,
   and `Payments Received` counts confirmed & completed only. Reports is the
   one place a Pending row counts as revenue.

### The fix is to split, not to choose

Do **not** simply drop Pending. The pipeline question ("what could this month
be worth?") is a real management question and the answer should stay on screen.
One number that merges committed work with un-reviewed enquiries answers
neither question — that is the defect class the panel has already flagged
repeatedly (a figure and its list counted on different bases with nothing
saying so).

Report both, each named, using **the vocabulary the app already has**. The
Payments page card already does exactly this:

```
₱X  Payments Received
+ ₱Y paid on bookings not yet confirmed
```

Follow that pattern. Do not invent new words.

### B1 · `src/pages/Reports/index.jsx` — derive the split

Near the existing `pendingInRangeCount` (~line 159), the block currently
computes `totalContractValue` over `activeBookingsInRange`. Keep that total
exactly as it is — it must not change, because three cards and the
FinancialTab division are tied to it.

**Add** two derived figures alongside it, in the same `forEach`:

- `acceptedContractValue` — sum of `total_amount` for bookings in
  `activeBookingsInRange` whose status is **not** `Pending`.
- `pendingContractValue` — sum of `total_amount` for bookings in
  `activeBookingsInRange` whose status **is** `Pending`.

Assert in a comment that `acceptedContractValue + pendingContractValue ===
contractValue` by construction, since `Pending` and not-`Pending` partition the
set.

Do the same split for outstanding:

- `acceptedOutstanding` — the existing outstanding sum, restricted to
  non-`Pending` bookings.

A Pending booking always has `paid = 0` (payments cannot be recorded before
Approved), so `acceptedOutstanding = acceptedContractValue −
paidAgainstEvents` holds exactly, with no residual. Verify this against live
data before you finish: ₱97,900 − ₱36,500 = ₱61,400.

Export all four on `financialSummary` beside `contractValue`. Change no
existing key.

Also add `pendingContractValue` to the values returned at ~line 571 alongside
`pendingInRangeCount`.

### B2 · `src/pages/Reports/OverviewTab.jsx` — show the amount, not just the count

Line ~60. The headline **stays** `contractValue` (the full estimate) — the card
is called *Estimated* Gross Revenue and that is what it should keep reporting.
What changes is the sub-line: it currently names a count where it should name
money.

Replace the sub so that when `pendingContractValue > 0` it reads:

```
Events in this period · ₱35,400 from 2 not yet approved
```

and when there are none, just `Events in this period` as today.

Then do the same for **`Unpaid on These Events`** (line ~62), whose sub is
currently `Of the events in this period`. When there is a pending amount, it
must say that part of it is not collectable yet — a manager reading an amount
under a heading with the word "Unpaid" will try to collect it:

```
Of the events in this period · ₱35,400 not collectable until approved
```

Keep the existing `StatCard` API. Do not change the values, only the `sub`
strings.

### B3 · `src/pages/Reports/FinancialTab.jsx` — fix the collection rate denominator

Lines ~20-21 and ~100-106. `collectedPct` divides by `contractValue`.

Change the **denominator to `acceptedContractValue`**, and change the printed
division line (~106) to match, so the on-screen arithmetic still reconciles
with the number above it:

```
₱36,500 paid ÷ ₱97,900 accepted gross revenue
```

Add a sub-line below it when `pendingContractValue > 0`:

```
Excludes ₱35,400 on 2 requests not yet approved — nothing can be collected on those yet.
```

Guard the division: if `acceptedContractValue` is 0, render the existing
zero-state rather than `NaN` or `Infinity`. There is currently a
`contractValue > 0` guard at line ~100 — move it to the new denominator.

Leave the `Estimated Gross Revenue` figure at line ~78 reading `contractValue`.
It is the estimate; it stays whole.

### B4 · `src/pages/Reports/DetailModal.jsx` — make the modal say the same thing

Line ~74, the subtitle currently reads:

```
Excludes Rejected and Cancelled bookings • 8 of 8 records shown
```

That names what is excluded and stays silent on the more surprising inclusion.
For the **revenue** modal specifically, it must also name what is included:

```
Excludes Rejected and Cancelled • Includes 2 not yet approved (₱35,400) • 8 of 8 records shown
```

Then the footer. Line ~202 prints a single `Total:`. When the filtered set
contains any `Pending` row, print the split beneath it, right-aligned in the
same cell, at a smaller size:

```
Total  ₱133,300   8 bookings
       ₱97,900 accepted · ₱35,400 awaiting approval
```

Both figures must be computed from `filteredData`, **not** from the summary —
the modal has working Type / Status / date filters, and a footer that ignores
them would reintroduce exactly the card-versus-list mismatch that PR-19 was
about. When `filteredData` has no Pending row, print only the existing single
total line.

### Acceptance for Part B

Run these against September 2026, This Month:

1. Overview card headline is unchanged at **₱133,300**.
2. Its sub-line reads **₱35,400 from 2 not yet approved** — the amount, not
   only the count.
3. `Unpaid on These Events` sub-line warns that ₱35,400 is not collectable yet.
4. FinancialTab collection rate reads **37.3%**, and the division beneath it
   prints ₱36,500 ÷ ₱97,900.
5. The revenue modal footer reads ₱133,300 total, split ₱97,900 accepted /
   ₱35,400 awaiting approval.
6. In the modal, set **All statuses → Pending**. The footer's split must follow
   the filter: accepted ₱0, awaiting ₱35,400, total ₱35,400. Set it to
   **Approved** and the split line must disappear entirely.
7. `acceptedContractValue + pendingContractValue` equals `contractValue` for
   every preset (All Time, This Month, This Year, Last 30 Days, Custom).
8. Set a date range with no bookings in it. Nothing renders `NaN`, `Infinity`
   or `₱0 ÷ ₱0`.

### Do not

- Do not remove Pending bookings from `contractValue`, from the modal list, or
  from any existing figure. Every current number must still be reachable.
- Do not add a new status, column, tab or filter.
- Do not touch `utils/reportMetrics.js` — `Payments Received` and its
  definitions are correct and shared with the Dashboard and Payments pages.
- Do not change `paidAgainstEvents`.
