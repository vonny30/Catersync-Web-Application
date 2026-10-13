# Feature: Suki customers and installment payment plans

**Status:** ready to build. The database script has **not** been applied to the live project yet.
It has been tested on a local copy of the live schema (PostgreSQL 16, built from the live tables, triggers, RLS policies, views and functions on 13 Oct 2026):

- all checks in the dry run pass;
- every existing booking's money and status values are unchanged;
- running the migration twice is safe;
- the rollback restores the schema exactly.
**Date:** 13 Oct 2026
**For:** Claude Code, working in `frontend/` (the CaterSync web admin) with the Supabase project `qreuaphaxvfayxqqniqg`
**Files that come with this spec:**

| File | What it is |
|---|---|
| `sql/suki_installments_2026-10-13.sql` | The migration. Apply it as ONE migration. |
| `sql/suki_installments_2026-10-13_dryrun.sql` | The same migration plus about 50 checks in one transaction, which ends with a deliberate `raise`, so nothing is kept. Its error message is the test report. |
| `sql/suki_installments_2026-10-13_rollback.sql` | Puts the database back exactly as it was on 13 Oct 2026. |
| `docs/mobile-suki-installments.md` | What the three mobile apps need to change. |

> **Read the whole spec before touching code.** The database enforces every rule below on its own, so a web bug cannot corrupt data. Your job on the web is to make those rules easy to see and use, and to show the database's error messages when it refuses something.

---

## 1. What the business asked for

PG's Catering has *suki* (loyal) customers who are trusted to pay a booking off in parts instead of paying the usual 50% deposit before the booking is confirmed.

1. Only the **Manager** decides who is suki. Customers cannot make themselves suki, and the mobile apps never write it.
2. When the manager approves a booking for a suki customer, they can choose an **installment plan** instead of the standard 50% deposit. Choosing a plan **confirms the booking at once**, with no deposit needed.
3. This works for **both package bookings and short orders**.
4. The manager stays in control and can **fix mistakes easily**. After a plan is saved, the manager can still:
   - change the **number of installments** (from 2 to 12), any due date, and any amount;
   - **end the plan**, which puts the booking back on the standard rules;
   - see a **history** of every change, with who made it, when, and why.

## 2. The rules, exactly as the database enforces them

| # | Rule | Where it is enforced |
|---|---|---|
| R1 | `customer.is_suki` can only be set by the manager, through `f_set_customer_suki`. If the mobile app tries to write it, the write is quietly reset. | `f_guard_customer_write`, `trg_customer_suki` |
| R2 | A **Blocked** customer is never suki. Blocking a suki customer clears the flag automatically, and a blocked customer cannot be made suki. | `trg_customer_suki`, `f_set_customer_suki` |
| R3 | `booking.payment_plan` is `'Standard'` (the default) or `'Installment'`. Only `f_save_installment_plan` and `f_end_installment_plan` can change it. Any other write is refused, or quietly reset if it comes from an app. | `b0_booking_plan_guard`, `f_guard_booking_write` |
| R4 | A **new plan** can be started only when all of these are true: the booking is **Approved or Confirmed**; the customer is **suki** and not blocked; and the event has not lapsed. An Approved booking becomes **Confirmed** with the status-log source `Suki installment plan`. | `f_save_installment_plan` |
| R5 | A schedule has **2 to 12 rows**. Each row has a valid `YYYY-MM-DD` date and an amount above ₱0 with at most 2 decimal places. Dates must be strictly increasing (no two on the same day). The amounts must add up to `booking.total_amount` **exactly**. For a **new** plan, the first due date cannot be before today (Manila time). | `private.f_check_installments` |
| R6 | **Editing** a plan is allowed while the booking is Confirmed or Completed, and **a reason is required**. The count, the dates and the amounts may all change. Past dates are allowed when editing, so the manager can record what was really agreed. | `f_save_installment_plan` |
| R7 | **Ending** a plan requires a reason. It deletes the schedule and sets the plan back to `Standard`. If the booking is Confirmed, the event is still ahead, and less than 50% has been paid, the booking goes back to **Approved**, flagged for review, with source `Installment plan ended`. That is exactly where a Standard booking with that much paid would be. | `f_end_installment_plan` |
| R8 | If the manager changes the **total** of an Installment booking, the difference is put on the **last installment** automatically and logged. If that would make the last installment ₱0 or less, the change is refused. (Today the web locks editing of Confirmed and Completed bookings, so this is only a safety net.) | `b0_booking_plan_guard` |
| R9 | A payment **reversal** never un-confirms an Installment booking. The 50% auto-revert applies to Standard bookings only. | `f_maybe_unconfirm_booking` |
| R10 | **Manager override** cannot move an Installment booking to Pending or Approved; the plan must be ended first. Every other override target still works. | `f_override_booking_status` |
| R11 | An Installment booking may be **Completed** once its event has started, **even if installments are still due**. The remaining balance stays receivable. This applies to both the manager and the Operations Manager app. | `f_guard_booking_write`, `f_completion_check` |
| R12 | Being **overdue** follows the schedule. An Installment booking is overdue when its earliest unpaid installment's due date has passed, regardless of the event date. Standard bookings keep the old rule: the event has passed and money is still owed. | `v_booking_money` |
| R13 | Payments are matched to installments **oldest first**, using verified net money (receipts minus refunds and reversals). Pending-verification money does not count. | `v_booking_installments`, `v_booking_money` |
| R14 | Installment rows have **no direct write permission** for anyone. They can only be read. | grants and RLS |
| R15 | Every create, edit and end action, and every automatic total adjustment, writes a row to `booking_installment_log` with the schedule before and after, the reason, and the manager. | the RPCs and the trigger |

What does **not** change:

- **Standard bookings** behave exactly as before. The dry run checks that no existing row's money, overdue, lapsed or threshold values change.
- **Payment stages**: the first receipt on a plan booking is still labelled `Deposit Collected`, so the existing kept-deposit rule (cancelling within 3 days of the event) treats it the same way.
- **Auto-complete** (`utils/autoComplete.js`) still completes only fully paid bookings. A plan booking that still owes money is completed by a person.

## 3. Rollout order. Do not reorder.

Expected dry-run report (from the local test; your ids, dates and row counts will differ):

```
R0 v_booking_money rows changed for existing bookings: 0
R0 v_customer_summary rows changed: 0
M1 refused non-suki: Only suki customers can pay in installments. …
M3a–M3i: each bad schedule refused with its message; "rows written after failures (expect 0): 0"
M4 plan saved: status=Confirmed plan=Installment n=3; status log source: Suki installment plan (Approved->Confirmed)
M5b total 9000->9500, last installment now (expect 3500): 3500.00 … too small total refused
M5c override to Approved: This booking is on an installment plan. End the plan first, …
M5d direct insert: permission denied for table booking_installment
P2 after reversal: status=Confirmed
P3 statuses: 1=Paid(3000.00), 2=Partly paid(1000.00), 3=Upcoming(0)
E1 money: overdue=true days=10 …
O1b ops after event, balance due: can_complete=true; O1c … Completed
C1a … false; C1b … Standard; C1c/C1d refused; C1e … 0
X1b ended: {… "booking_status": "Approved", "reverted_to_approved": true}
S1a after block: is_suki=false …; S1b refused
V2a anon reads v_booking_money: N rows   (no permission error)
```

1. **Dry run.** Run `sql/suki_installments_2026-10-13_dryrun.sql` in the Supabase SQL editor, or with `execute_sql`. It must end with the error `DRY RUN RESULTS (rolled back): …`. Read every line:
   - no line may contain `FAIL` or `ERROR`;
   - every `R0 … changed` count must be `0`.

   Note: the Supabase MCP asks the user to confirm SQL containing `DROP`/`DELETE`, so run it while the user is there to approve it.
2. **Apply** `sql/suki_installments_2026-10-13.sql` as one migration named `suki_installments`.
3. **Check after applying:**
   - `select count(*) from booking where payment_plan <> 'Standard'` returns `0`;
   - `select count(*) from customer where is_suki` returns `0`;
   - the web app still loads every page;
   - run `get_advisors` (security) and confirm there are no new warnings for `booking_installment*` or `v_booking_installments`.
4. **Web changes** (§5), then the acceptance tests (§7).
5. **Mobile apps** follow `docs/mobile-suki-installments.md`. Because the database guards everything, the old mobile builds keep working in the meantime. They just won't show the schedule.

To undo, run `sql/suki_installments_2026-10-13_rollback.sql` in one transaction. It deletes the suki flags and the schedules; payments are not touched.

## 4. Database reference (what the web calls and reads)

### 4.1 New columns

| Table | Column | Notes |
|---|---|---|
| `customer` | `is_suki boolean not null default false` | Set only through the RPC. |
| | `suki_since timestamptz` | Stamped automatically when the customer becomes suki; cleared when that is removed. |
| | `suki_set_by uuid → manager.manager_id` | Stamped automatically. |
| | `suki_note text` | An optional note, for example "Loyal since 2019, church events". |
| `booking` | `payment_plan varchar(12) not null default 'Standard'` | `'Standard'` or `'Installment'`. |

### 4.2 New tables (read-only from the web)

`booking_installment`:

| Column | Notes |
|---|---|
| `installment_id` | |
| `booking_id` | |
| `installment_no` | 1 to 12 |
| `due_date` | date |
| `amount` | numeric(10,2) |
| `created_at` | |
| `created_by` | |

It is in `supabase_realtime`.

`booking_installment_log`:

| Column | Notes |
|---|---|
| `log_id` | |
| `booking_id` | |
| `action` | `Created`, `Updated` or `Ended` |
| `before_plan` / `after_plan` | jsonb arrays of `{no, due_date, amount}` |
| `reason` | |
| `changed_by` | → manager |
| `changed_at` | |

The manager can read both tables. Customers can read only their own bookings' `booking_installment` rows.

### 4.3 Views

`v_booking_installments`: one row per installment.

| Column | Meaning |
|---|---|
| `installment_id`, `booking_id`, `booking_number`, `booking_status` | |
| `installment_no`, `due_date`, `amount` | |
| `cum_due` | Running total up to and including this row. |
| `covered` | How much of this row verified payments have covered so far. |
| `remaining` | `amount - covered` |
| `status` | `Paid`, `Closed` (the booking was Rejected or Cancelled), `Overdue`, `Due` (due today), `Partly paid` or `Upcoming`. |
| `is_overdue`, `days_overdue` | Counted only while the booking is Confirmed or Completed. |

`v_booking_money` keeps every existing column, in the same order. These columns are **added at the end**:

| Column | Meaning |
|---|---|
| `payment_plan` | |
| `installment_count` | 0 for Standard bookings. |
| `amount_due_now` | Installments due up to today minus net paid, never below 0. **Null for Standard bookings.** |
| `next_due_date`, `next_due_amount` | The earliest installment not yet fully covered, and what is still owed on it. Null when the booking is fully covered or Standard. |

`is_overdue` and `days_overdue` are now plan-aware (R12). Every page that already reads them (Receivables, Dashboard, `utils/overdue.js`) becomes correct with no change.

`v_customer_balance` adds `is_suki`.

`v_customer_summary` adds these columns:

- `is_suki`, `suki_since`, `suki_set_by`, `suki_note`;
- `installment_bookings`: open plan bookings;
- `overdue_installment_bookings`.

### 4.4 RPCs. All are manager-only and `security definer`, and each raises a readable message on refusal.

```js
// R1/R2. Returns the updated customer row.
await supabase.rpc('f_set_customer_suki', { p_customer_id, p_is_suki: true, p_note: 'optional' });

// R4–R6. Create, or replace, the whole schedule.
await supabase.rpc('f_save_installment_plan', {
  p_booking_id,
  p_installments: [{ due_date: '2026-10-20', amount: 3000 }, { due_date: '2026-11-20', amount: 3000 }],
  p_reason: null,          // required (non-empty) when the booking already has a plan
});
// → { booking_id, booking_status, payment_plan: 'Installment', installments: [{no, due_date, amount}] }

// R7
await supabase.rpc('f_end_installment_plan', { p_booking_id, p_reason: 'Customer will pay normally' });
// → { booking_id, booking_status, payment_plan: 'Standard', reverted_to_approved: boolean }
```

Always send `due_date` as a plain `'YYYY-MM-DD'` string. Never use `toISOString()`, because UTC shifts the date. Send `amount` as a number rounded to 2 decimals.

The error messages the user can see. Show `error.message` as it is, since these are written for the manager:

- "Only suki customers can pay in installments. Mark the customer as suki first."
- "An installment plan needs 2 to 12 installments (got N)."
- "The installments add up to ₱X but the booking total is ₱Y. They must match exactly."
- "Due dates must be in order with no two on the same day (installment N)."
- "The first installment cannot be due before today."
- "Installment N has an invalid due date." / "…invalid amount." / "…must be more than ₱0." / "…more than two decimal places."
- "Give a reason for changing the installment schedule." / "Give a reason for ending the installment plan."
- "An installment plan can only be started on an Approved or Confirmed booking (this one is X)."
- "Cannot confirm BKG-XXX: its event date has passed."
- "This booking is on an installment plan. End the plan first, then change its status." (from an override)
- "The new total (₱X) is too small for the current installment schedule. Edit the schedule (or end the plan) first."
- "A blocked customer cannot be marked as suki. Unblock the account first."

`f_completion_check(p_booking_id)` now also returns `payment_plan`. For a plan booking it no longer returns `reason: 'balance_due'`.

## 5. Web changes, file by file

Keep each change small, and match the existing style: Tailwind, `toast`, `ConfirmModal`, and the existing hooks. **Do not** change Standard-booking behaviour anywhere.

### 5.1 New `src/utils/installments.js`

```js
export const PAYMENT_PLAN = { standard: 'Standard', installment: 'Installment' };
export const isInstallmentPlan = (b) => b?.payment_plan === PAYMENT_PLAN.installment;
export const MIN_INSTALLMENTS = 2, MAX_INSTALLMENTS = 12;

// Today in Manila as 'YYYY-MM-DD' (matches private.f_today_manila()).
export const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

// Add whole months to a 'YYYY-MM-DD'; clamp to the month's last day (Jan 31 + 1 → Feb 28/29).
export function addMonthsYmd(ymd, n) { /* pure string/Date.UTC math, no local TZ */ }

// Even split in centavos; any remainder goes on the LAST row. Monthly from firstDue.
export function buildEvenSchedule({ total, count, firstDue }) {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => ({
    due_date: addMonthsYmd(firstDue, i),
    amount: (i === count - 1 ? cents - base * (count - 1) : base) / 100,
  }));
}

// Mirror of private.f_check_installments, for instant feedback. The database stays the authority.
// Returns { ok, rowErrors: { [index]: 'message' }, formError, sum, difference }.
export function validateSchedule({ total, rows, isNew, today = todayManila() }) { ... }

export const toRpcRows = (rows) => rows.map(r => ({ due_date: r.due_date, amount: Math.round(Number(r.amount) * 100) / 100 }));

export const INSTALLMENT_STATUS_PILL = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Partly paid': 'bg-sky-50 text-sky-700 border-sky-200',
  Due: 'bg-amber-50 text-amber-700 border-amber-200',
  Overdue: 'bg-red-50 text-red-700 border-red-200',
  Upcoming: 'bg-slate-50 text-slate-600 border-slate-200',
  Closed: 'bg-slate-100 text-slate-500 border-slate-200',
};
```

Add unit-style checks next to the existing ones, if there are any; otherwise a short self-check in the PR description is enough. The checks must cover these cases:

- 9000 split 3 ways gives `3000 × 3`;
- 10000 split 3 ways gives `3333.33, 3333.33, 3333.34`;
- Jan 31 plus 1 month gives Feb 28 (Feb 29 in a leap year);
- validation catches each error in R5.

### 5.2 New `src/components/InstallmentScheduleEditor.jsx`

This is a controlled component with props `{ total, rows, onChange, isNew, paidSoFar }`. It shows:

- a **count stepper** (2 to 12) and a **"Split evenly"** button;
- changing the count regenerates the schedule with `buildEvenSchedule`, keeping the current first due date. When editing an existing plan, ask before overwriting rows the manager typed by hand;
- one row per installment: a number, a date input, and an amount input (₱, 2 decimals). Inline errors come from `validateSchedule`;
- a footer that reads **"Schedule ₱X of ₱Total"**, with the difference shown in red while it is not zero, and a **"Put difference on last"** button;
- when `paidSoFar > 0`, a note that payments are applied oldest first, and how many rows are already covered.

### 5.3 New `src/components/InstallmentPlanCard.jsx`, used on `BookingDetails.jsx` and `ShortOrderDetails.jsx`

Put it in the payments area, next to the existing collected/balance block.

**Data:**

- `v_booking_installments` for the booking, ordered by `installment_no`;
- `booking_installment_log` for the booking, ordered by `changed_at desc`, joined to `manager` for the name;
- the booking's `v_booking_money` row, which the page already loads; add the new columns to its select.

Refresh through `useRealtimeRefresh` on `booking_installment`, as well as on the existing `payment` and `booking` events.

**What it shows, depending on the booking:**

| Situation | What the card shows |
|---|---|
| A **Standard** booking, the customer **is suki**, and the status is **Approved or Confirmed** | A small "Suki customer" note and a **"Start installment plan"** button. The button opens a modal with the editor (default: 3 monthly installments from today) and an optional note. It calls `f_save_installment_plan`; on success, toast "Installment plan saved — booking confirmed." (or "Installment plan saved." if it was already Confirmed) and refresh. |
| A **Standard** booking otherwise | Nothing. |
| An **Installment** booking | See below. |

For an **Installment** booking, the card shows:

- a header: "Installment plan · N installments", with a **Paid ₱x of ₱y** progress bar, **Due now ₱amount_due_now**, and **Next: ₱next_due_amount on next_due_date**. Show a red **Overdue N days** pill when `is_overdue`;
- a table with these columns: #, Due date, Amount, Covered, Status pill;
- these actions:
  - **Edit schedule**, shown while the booking is Confirmed or Completed. It opens the editor, prefilled with the current rows, and a **required reason** field. It calls `f_save_installment_plan` with `p_reason`.
  - **End plan**, which opens a `ConfirmModal` with a required reason. The modal text reads: "The booking goes back to the standard 50% rule. If less than 50% is paid and the event is still ahead, it will return to Approved and be flagged for review." It calls `f_end_installment_plan` and toasts based on `reverted_to_approved`.
  - **History**, a collapsible list of log rows. Each row shows the action, the date and time, the manager's name and the reason, plus a compact before → after diff: rows added or removed, and changed dates or amounts.

Every action button is disabled while its request is in flight, so double-clicks do nothing. On error, show `error.message` in a toast and keep the modal open.

### 5.4 Approval: `components/ApprovalModal.jsx` and `hooks/useApprovalHandlers.js`

1. When the modal opens, load the customer's `is_suki`. Read it from `customer` (or `v_customer_summary`) by `customer_id`. If the customer is suki, show a **Suki** badge beside their name.
2. For a suki customer, add a **Payment** choice:
   - **Standard (50% deposit)**, the default and the current behaviour;
   - **Installment plan**.

   Choosing the installment plan:
   - shows the editor, fed with the **same final total the modal displays**, including the approval fee and delivery fee;
   - replaces the "Deposit (50%)" line (around line 140) with "First installment: ₱X due <date>";
   - shows the note "Approving will confirm this booking immediately."
3. Finalize is disabled until `validateSchedule(...).ok`.
4. In `handleFinalizeApproval`, run **every existing step unchanged**:
   - pax check;
   - past-date warning;
   - equipment block;
   - short-order cap;
   - the update to `'Approved'` with the total and fees;
   - equipment allocation;
   - vehicle allocation;
   - restaging receipts.

   **Then**, if Installment was chosen, call `f_save_installment_plan(booking_id, toRpcRows(rows), null)`.
   - The schedule must be built against the **exact `total_amount` the handler just wrote**. Pass that number into the editor state rather than recomputing it.
   - If the RPC fails, the booking stays **Approved**, which is safe. Show: `Booking approved, but the installment plan was not saved: ${error.message}. Open the booking to set the plan.` and do **not** roll back the approval.
   - On success, toast "Approved and confirmed on an installment plan."
5. A non-suki customer sees no change at all.

### 5.5 Receipts: `utils/payments.js`, `components/ReceiptFields.jsx`, `hooks/usePaymentHandlers.js` and `pages/Receivables.jsx`

- `validateReceipt({ …, paymentPlan })`: skip **only** the "deposit must be at least 50%" rule when `paymentPlan === 'Installment'`. Every other rule stays: amount above 0, the method, not more than the balance, and the receipt number or proof image.
- Every caller must pass the booking's `payment_plan`. Add it to their selects.
- `ReceiptFields.jsx`: for plan bookings, replace the "Deposit: at least 50%…" hint with "Installment plan — due now ₱{amount_due_now}; next ₱{next_due_amount} on {date}". Add a **"Use amount due now"** quick-fill. If `amount_due_now` is 0, quick-fill `next_due_amount` instead.
- `stageForReceipt` / `restageReceipts`: **no change**.

### 5.6 Completion: `utils/completion.js`, the list pages and `hooks/useCompletionHandlers.js`

- `completeLockReason({ eventDatetime, owed, paymentPlan })`: when the plan is Installment, ignore `owed`. The event rule still applies.
- Update every caller to pass `payment_plan`:
  - `Bookings.jsx` (around line 1312);
  - `ShortOrders.jsx` (around line 1202);
  - both detail pages;
  - `useCompletionHandlers.js`.
- In the completion confirm text for a plan booking with money owed, add "₱X in installments will stay receivable."
- `utils/autoComplete.js`: **leave it alone.** Check that it only completes bookings that are fully paid; it should, given `is_fully_paid` or `outstanding <= 0`.

### 5.7 Status: `components/OverrideStatusModal.jsx` and `components/StatusHistory.jsx`

- **OverrideStatusModal:** for an Installment booking, disable the **Pending** and **Approved** options, with the hint "End the installment plan first." The database refuses them anyway.
- **StatusHistory `SOURCE_TONE`:**

  | Source | Tone | Label |
  |---|---|---|
  | `'Suki installment plan'` | green, like the auto-confirm tone | "Suki installment plan" |
  | `'Installment plan ended'` | amber | "Installment plan ended" |

### 5.8 Customers: `pages/Customers.jsx`

- **List:** a small **Suki** badge, emerald and star-like, next to the name when `is_suki`. Add a filter chip **"Suki"** (`is_suki = true`) beside the existing Repeat customer filter.
- **Drawer:**
  - a **Suki** section with a toggle, "Mark as suki" / "Remove suki status", and an optional note when marking. It calls `f_set_customer_suki`.
  - Show "Suki since {date} · set by {manager name}" and the note.
  - When the account is Blocked, disable the toggle with the tooltip "Unblock the account first."
  - Removing suki status does **not** end existing plans. Say so in the confirm text: "Existing installment plans stay as they are."
- **Block action** (around line 342): when the customer is suki, add "Their suki status will be removed." to the confirm text. The database does it automatically.
- **Drawer bookings tab:** an "Installment" chip on plan bookings, and an "N installment plan(s), M overdue" line from `installment_bookings` and `overdue_installment_bookings`.

### 5.9 Lists and receivables: `pages/Bookings.jsx`, `pages/ShortOrders.jsx` and `pages/Receivables.jsx`

- **Bookings and ShortOrders cards:** an **"Installment"** chip when `payment_plan = 'Installment'`, and a small **Suki** badge next to the customer name. Add `is_suki` to the customer select.
- Add a list filter **"Installment plans"**. Wire it through `utils/listFilters.js` the same way the other filters work.
- **Receivables:** add an **"Installment plans"** filter. For plan rows, show **"Due now ₱amount_due_now · Next ₱next_due_amount on next_due_date"** instead of the event-based wording. The overdue badge and days already come from the view.
- **Detail pages:** the "unpaid past event" banner (`hasUnpaidPastEvent`, around line 1884) and the "completed with balance" warning (around line 1908) must **not** show for plan bookings. The plan card covers them. Apply the same rule to `ShortOrderDetails.jsx`.

### 5.10 Everywhere `v_booking_money` is read with an explicit column list

Add `payment_plan` (and, only where needed, `amount_due_now`, `next_due_date`, `next_due_amount`) to the select. Do not use `select('*')` on hot lists.

## 6. Edge cases, and the expected behaviour

| Case | Expected |
|---|---|
| The manager picks Installment for a customer who stopped being suki in another tab | The RPC refuses with "Only suki customers…"; the booking stays Approved. |
| Two managers edit the same plan at once | The RPC locks the booking row (`for update`), so the last save wins and both saves are logged. The card refreshes through realtime. |
| A schedule with 3-decimal amounts, or "abc" as a date | The client editor blocks it; the database refuses it if it gets through. |
| An installment's due date is after the event | Allowed. That is the point of the feature for trusted customers. |
| The customer pays more than an installment | The extra covers the next installment, because payments are applied oldest first. |
| The customer pays everything early | Every row becomes Paid, `next_due_*` becomes null, `is_fully_paid` becomes true, and auto-complete applies as normal after the event. |
| A payment is reversed | The booking stays Confirmed (R9). Installment statuses go back to unpaid, and overdue appears if a due date has passed. |
| A Confirmed plan booking is cancelled | Allowed as before. Installments show `Closed`; nothing is receivable. |
| The manager overrides a plan booking to Completed, Cancelled or Rejected | Allowed. |
| The manager overrides it to Approved or Pending | Refused (R10). |
| A suki customer is blocked | The suki flag is cleared. Existing plans keep running, and the manager decides whether to end them. |
| A Completed plan booking still owes money | It stays in Receivables, overdue per schedule, until it is paid. |
| A plan booking is edited after Completion | Allowed, with a reason (R6). |
| The mobile app tries to set `payment_plan` or `is_suki` | The value is quietly reset; the RPCs refuse with "Only the manager…". |
| The approval succeeded but saving the plan failed | The booking is Approved; the card shows "Start installment plan" so it can be retried. |

## 7. Acceptance tests (run on a test customer, then delete the test rows)

1. **Database:** the dry-run report is clean (§3).
2. Mark a test customer suki → the badge appears in the list and drawer, with since, by and note. Block them → the suki flag is cleared. Unblock and mark suki again.
3. Create a short order for that customer, then approve it with an Installment plan of 3 rows:
   - the booking is **Confirmed**;
   - the status history shows "Suki installment plan";
   - the card shows 3 Upcoming or Due rows;
   - no 50% deposit is requested.
4. Record a receipt below 50% (for example 10%) → accepted, staged `Deposit Collected`, and row 1 shows Partly paid or Paid.
5. Edit the schedule to 5 installments, giving a reason → saved, and History shows Updated, the reason and the diff. Try saving with a wrong sum → the error appears and nothing changes.
6. Reverse the receipt → the booking stays Confirmed.
7. Use Override to Approved → refused, with the message.
8. Move the event to yesterday by override or seed data, then press Complete → allowed with a balance; "₱X stays receivable" is shown, and Receivables lists it.
9. On a second booking, end the plan with less than 50% paid and a future event → Approved, flagged, history logged.
10. Approve a booking for a **non-suki** customer → the modal looks exactly as it did before.
11. Run a regression pass on a Standard booking through the whole flow: approve, deposit, confirm, complete. Nothing should change.
12. Clean up: delete the test bookings and customer as the existing tests do. Check that `booking_installment` and `booking_installment_log` hold no orphan rows (both cascade on booking delete).

## 8. Do not

- Do not write to `booking_installment` or `booking_installment_log` directly. Writes are not granted and will fail.
- Do not set `payment_plan` in any `.update()` or `.insert()` on `booking`.
- Do not compute "overdue" for plan bookings on the client. Read `is_overdue`, `days_overdue`, `next_due_*` and `amount_due_now` from the views.
- Do not use `new Date().toISOString().slice(0,10)` for due dates (it gives the UTC day). Use `todayManila()` and string date math.
- Do not change `stageForReceipt`, `autoComplete.js` or the kept-deposit rule.
- Do not apply the migration before the dry run passes.

## 9. Decisions taken (change them here before building if the business disagrees)

| Question | Decision |
|---|---|
| Can a plan be started after approval? | Yes, on any Approved or Confirmed booking of a suki customer, from the detail page. |
| Minimum and maximum number of installments | 2 to 12. |
| Must the last installment be due before the event? | No. |
| Late fees or interest | None. Overdue is only flagged. |
| Does the customer see that they are "suki"? | No. The mobile app shows the plan, not the label. |
| Removing suki status | Does not end existing plans. |
| Kept deposit on cancellation within 3 days | The first plan receipt counts as the deposit, same as today. |
