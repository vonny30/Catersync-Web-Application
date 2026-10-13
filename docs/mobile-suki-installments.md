# Prompt for the mobile apps: suki customers and installment plans

> Paste everything below the line into the AI assistant (or give it to the developer)
> working on the CaterSync mobile apps. It covers the **Customer app**, the
> **Operations Manager app** and the **Main Cook (Kitchen) app**.
>
> **Timing:** give this to the mobile side only **after** the manager website team says
> `sql/suki_installments_2026-10-13.sql` is live. Until then, the columns and views
> below do not exist yet. Old app builds keep working after it goes live, because
> the database protects every new field; they simply won't show the schedule.

---

You are updating the CaterSync mobile apps for PG's Catering. The database now supports
**suki (loyal) customers** and **installment payment plans**. **Do not change the
database.** Everything below is already live and enforced there. Your job is to read
the new data, show it clearly, and stop showing rules that no longer apply to these
bookings.

## What changed (read first)

- The **Manager** marks some customers as *suki* on the website. For a suki customer's
  booking, the manager can choose an **installment plan** when approving it, or later.
  Choosing a plan **confirms the booking immediately**, with no 50% deposit needed. The
  customer then pays according to a schedule of 2 to 12 installments, each with a due
  date and an amount.
- This works for both **Package** bookings and **Short Orders**.
- The manager can edit the schedule, change the number of installments, or end the plan
  at any time. The app must always show **what is stored now**, and refresh when it
  changes (see Realtime below).
- **Only the manager writes any of this.** If an app tries to write `customer.is_suki`,
  `customer.suki_note`, `booking.payment_plan` or any installment row, the database
  either quietly keeps the old value or refuses. There is nothing for the app to write.

### New data the apps can read

| Where | Field | Meaning |
|---|---|---|
| `booking` / `v_booking_money` | `payment_plan` | `'Standard'` (the normal 50% rule) or `'Installment'`. Exact, case-sensitive. |
| `v_booking_money` | `installment_count` | The number of installments (0 for Standard). |
| | `amount_due_now` | What should have been paid by today and is not yet. **Null for Standard bookings.** |
| | `next_due_date`, `next_due_amount` | The earliest installment not yet fully paid, and what is left on it. Null when paid up or Standard. |
| | `is_overdue`, `days_overdue` | For plan bookings these now follow the **schedule** (an installment date has passed and it is unpaid), not the event date. |
| `v_booking_installments` | one row per installment | `installment_no`, `due_date` (date), `amount`, `covered`, `remaining`, `status`, `is_overdue`, `days_overdue` |
| `booking_installment` | the raw schedule | `installment_no`, `due_date`, `amount` (use the view above when you can) |

`v_booking_installments.status` is one of these values, shown as stored:

| Status | Meaning |
|---|---|
| `Paid` | fully covered |
| `Partly paid` | some money has been applied to it |
| `Due` | due today |
| `Overdue` | the due date has passed and it is not fully paid |
| `Upcoming` | not due yet |
| `Closed` | the booking was cancelled or rejected |

Payments are applied to installments **oldest first**, using **verified** money only.
A payment still `Pending Verification` does not count until the manager verifies it.

Row-level security lets a customer read the installments of **their own bookings only**.

## 1. Customer app

### Booking details (both Package and Short Order)

1. If `payment_plan = 'Installment'`, show an **"Installment plan"** section:
   - a summary: "Paid ₱{net_paid} of ₱{total_amount}" with a progress bar (`paid_pct`);
   - **"Amount due now: ₱{amount_due_now}"**, shown only when it is above 0, in red when
     `is_overdue`;
   - **"Next payment: ₱{next_due_amount} on {next_due_date}"**, shown only when
     `next_due_date` is not null;
   - the schedule, from `v_booking_installments` ordered by `installment_no`. Each row
     shows its number, due date, amount and status badge, with green for Paid, blue for
     Partly paid, amber for Due, red for Overdue, grey for Upcoming and Closed.
2. **Hide all 50% deposit wording** for plan bookings: "Pay at least 50% to confirm",
   "Deposit required", "Waiting for downpayment", and similar. The booking is already
   Confirmed.
3. Status text for a plan booking that is `Confirmed`: *"Confirmed: paying in
   installments."* Keep the normal wording for every other status.
4. **Do not show the word "suki"** or any loyalty label to the customer. The app shows
   the plan, not the label. Do not read `customer.is_suki` for display.
5. If the manager ends the plan, `payment_plan` goes back to `'Standard'` and the
   schedule disappears. The booking may also go back to `Approved` if less than 50%
   was paid. Show whatever is stored. The normal 50% rule applies again from then on.

### Paying

6. Submitting a payment is **unchanged**: insert into `payment` with
   `pay_status = 'Pending Verification'`, `entry_type = 'Receipt'`, and the same fields
   and proof upload you use today. Keep writing `pay_installment` exactly as you do now.
7. For a plan booking:
   - prefill the amount with `amount_due_now` when it is above 0, otherwise with
     `next_due_amount`. The customer may change it;
   - allow **any amount above 0 up to `outstanding`**. **Do not enforce a 50% minimum.**
     The database never did; the old app rule must now be skipped for plan bookings;
   - helper text: *"Payments are applied to your earliest unpaid installment first."*
8. For a Standard booking, change nothing.

### Lists and notifications

9. In "My bookings", show a small **"Installments"** chip on plan bookings. If
   `is_overdue`, show *"Payment overdue"* in red. This replaces any event-date-based
   overdue text for plan bookings.
10. If the app sends local reminders or notifications, base payment reminders for plan
    bookings on `next_due_date`, for example one day before it. Do not base them on the
    event date.
11. **Realtime:** `booking_installment` is in the `supabase_realtime` publication. While
    a booking's detail screen is open, subscribe to
    `postgres_changes` on `public.booking_installment` with filter
    `booking_id=eq.<id>`, as well as the `booking` and `payment` subscriptions you
    already have. Refetch `v_booking_money` and `v_booking_installments` on any event.
    When the manager edits the schedule, the whole set is replaced, so expect a burst
    of DELETE and INSERT events and debounce the refetch (about 300 ms).

### Sample queries (supabase-js)

```js
// Money + plan summary for one booking
const { data: money } = await supabase
  .from('v_booking_money')
  .select('booking_id, booking_status, total_amount, net_paid, outstanding, paid_pct, is_fully_paid, is_overdue, days_overdue, payment_plan, installment_count, amount_due_now, next_due_date, next_due_amount')
  .eq('booking_id', bookingId)
  .single();

// Schedule (only when money.payment_plan === 'Installment')
const { data: schedule } = await supabase
  .from('v_booking_installments')
  .select('installment_no, due_date, amount, covered, remaining, status, is_overdue, days_overdue')
  .eq('booking_id', bookingId)
  .order('installment_no');
```

`due_date` is a plain date (`'YYYY-MM-DD'`). Format it as a date, and do **not** convert
it through a timezone, or it may show the previous day.

## 2. Operations Manager app

12. Completing a booking: keep calling `f_completion_check(p_booking_id)` before you
    show the Complete button, as you do today. Its result now includes `payment_plan`.
    For an **Installment** booking whose event has started, it returns
    `can_complete: true` even when money is still owed. The remaining installments
    stay with the manager to collect.
13. When `payment_plan = 'Installment'` and `outstanding > 0`, show a neutral note on the
    confirm sheet: *"On an installment plan. The balance is collected by the manager."*
    Do not block, and do not show a red "balance due" warning.
14. The Ops app cannot read payments, so do not try to show installment progress. Show
    only the plan chip ("Installments") if you wish.
15. Nothing else changes: same status writes, `status_order`, equipment and vehicle
    rules.

## 3. Main Cook (Kitchen) app

16. **No change.** Plan bookings are ordinary `Confirmed` bookings for the kitchen. Do not
    show payment-plan details in the kitchen app.

## 4. Things the apps must never do

- Write `customer.is_suki`, `suki_since`, `suki_set_by`, `suki_note` or
  `booking.payment_plan`. The writes are quietly ignored.
- Insert, update or delete `booking_installment` or `booking_installment_log`. These
  are refused.
- Call `f_set_customer_suki`, `f_save_installment_plan` or `f_end_installment_plan`.
  These are manager-only and are refused with "Only the manager…".
- Work out "overdue" or "amount due" yourself for plan bookings. Read them from
  `v_booking_money` and `v_booking_installments`.
- Show the 50% deposit rule on a plan booking.

## 5. Test checklist (use a test customer the manager marks suki, then deletes)

| # | Do this | Expect |
|---|---|---|
| 1 | Book a Short Order in the customer app | `Pending`, `payment_plan = 'Standard'`, the normal 50% wording |
| 2 | The manager approves it with a 3-installment plan | The app (with realtime) shows **Confirmed**, the "Installment plan" section, 3 rows, and no 50% wording |
| 3 | Pay 10% from the app | Saved as `Pending Verification`; the schedule does not change until it is verified |
| 4 | The manager verifies it | Row 1 shows Partly paid or Paid; "Amount due now" goes down |
| 5 | The manager edits the schedule to 5 rows | The app refreshes to 5 rows without a restart |
| 6 | A due date passes, unpaid (or the manager sets a past date when editing) | The row shows `Overdue`; the booking card shows "Payment overdue" |
| 7 | Try to update `payment_plan` or `is_suki` from the app (dev build) | The row reloads unchanged |
| 8 | Ops app: the event has started, money is still owed on the plan | Complete is allowed, with the neutral note |
| 9 | The manager ends the plan (less than 50% paid, future event) | The app shows `Approved`, the schedule is gone, and the 50% wording is back |
| 10 | A Standard booking, end to end | Exactly as before |
