# Prompt for the mobile apps — updates up to 1 October 2026

> Paste everything below the line into the AI assistant (or give it to the developer)
> working on the CaterSync mobile apps. It covers the **Customer app**, the
> **Operations Manager app** and the **Main Cook (Kitchen) app**, which all share one
> Supabase project with the manager website.

---

You are updating the CaterSync mobile apps for PG's Catering. The manager website and
the database have changed. Bring the apps in line with the rules below. **Do not change
the database** — every rule here is already live. Your job is the app side: show the
right buttons, read the right data, and explain refusals to the user.

## How the database behaves now (read first)

- Guard triggers protect `booking`, `payment`, `customer`, `booking_equipment` and
  `vehicle_assign`. When an app sends a change it is not allowed to make, **the update
  still succeeds but the protected fields keep their old values**. There is no error.
  So: never assume a save worked — **reload the row after saving** and show what is
  actually stored. Better still, don't offer actions the rules forbid (below).
- Stored values are exact and case-sensitive. `booking_status`: `Pending`, `Approved`,
  `Confirmed`, `Completed`, `Rejected`, `Cancelled`. Whenever you write
  `booking_status`, also write `status_order` (Pending 1, Approved 2, Confirmed 3,
  Completed 4, Rejected 5, Cancelled 6). Customer cancels → `Cancelled`. Only the
  manager rejects.
- `payment.pay_status`: `Pending Verification`, `Proof Rejected`, `Deposit Collected`,
  `Partially Settled`, `Fully Settled`, `Refunded`, `Reversed`. `pay_method`: `Cash`,
  `GCash`, `Bank Transfer`.
- Money per booking comes from the view **`v_booking_money`** (`total_amount`,
  `net_paid`, `outstanding`, `paid_pct`, `is_fully_paid`, `meets_confirm_threshold`,
  `awaiting_verification`, `is_lapsed`, `is_overdue`). Don't add up payments yourself.
  Payments still awaiting verification are **not** paid money.
- A booking is **lapsed** (`v_booking_money.is_lapsed`) when it is still Pending or
  Approved and its event date has passed. A lapsed booking can't be approved or
  confirmed, so don't offer "pay to confirm" on it.

## 1. Customer app

**Bookings**
1. A new booking is always saved as `Pending`, whatever status the app sends.
2. The customer may edit pax, date, venue, menu and total **only while `Pending`**. After
   that, show those fields read-only with the note *"Contact PG's Catering to change
   this booking."* (Edits are silently ignored by the database.) `notes` and
   `motif_color` can still be edited.
3. The customer may **cancel** from `Pending`, `Approved` or `Confirmed`. Hide Cancel for
   `Completed`, `Rejected` and `Cancelled`.
4. Booking rules to show before submitting (the manager enforces them at approval):
   - at least **3 days** before the event;
   - free delivery within **Bayawan City, Santa Catalina and Basay**; a delivery fee may
     apply elsewhere, and the final price is the one on the approved booking;
   - the kitchen takes at most **4 Short Orders per day**, so an order for a busy day
     may not be approved.

**Payments**
5. A payment from the app is always saved as `Pending Verification` and entry type
   `Receipt`. Amount must be greater than zero, and the booking must belong to the
   customer. The database returns these messages; show them as they are:
   *"Enter an amount greater than zero."* / *"This booking does not belong to your account."*
6. The booking is **confirmed automatically** once verified payments reach **50% of the
   total**. On the booking screen show: paid so far, amount awaiting verification,
   balance (`outstanding`), and progress to 50% (`paid_pct`, `meets_confirm_threshold`).
7. **Where to pay:** don't hard-code GCash or bank numbers. Read them from
   `payment_account`:
   ```sql
   select method, bank_name, account_name, account_number, qr_image_url, instructions
   from payment_account where is_active
   order by sort_order, method, account_name;
   ```
   Show the QR when `qr_image_url` is set. Subscribe to realtime on this table so an open
   payment screen updates when the manager edits it. If no rows are active, show
   *"Online payment details are not available right now. Please contact PG's Catering."*
8. **Proof uploads** go to the `images` bucket, folder **`payments/`** only. Any other
   folder is refused. Allowed: JPEG, PNG, WebP, GIF, HEIC/HEIF, PDF, up to **10 MB**.
   Always pass `contentType` on upload. Existing `getPublicUrl()` links keep working.
   Proofs can't be listed by other users.

**Account**
9. **Blocked accounts:** on sign-in and before submitting a booking or payment, read
   `customer.account_status`. If it is `Blocked`, stop with *"This account can't place
   bookings right now. Please contact PG's Catering."* The app can't change
   `account_status`, `source`, `status_reason` or `user_id`.
10. **Walk-in customers** created at the counter get their own one-time password (like
    `Cs-7KMX-4QPT9!`). Make sure there is a **Change password** screen and that Forgot
    Password works, so they can set their own.
11. **Privacy Notice and Terms:** under the sign-up button add *"By creating an account
    you agree to our Terms of Service and Privacy Notice."* linking to
    `https://catersync-web-application.vercel.app/terms` and
    `https://catersync-web-application.vercel.app/privacy`. Add both links to the
    profile/settings screen too.
12. **Business name and contact details:** read them from `business_profile` (one row:
    `business_name`, `email`, `phone`, `address`). Anyone can read it, only the manager
    can change it. Use it wherever the app shows PG's name, phone, email or address,
    and anywhere a message says "contact PG's Catering". Any of the three contact
    fields may be empty, so show only the ones that are set. Format `phone`
    (`09XXXXXXXXX`) as `0917 123 4567`.

## 2. Operations Manager app

**Completing a booking** follows the same rule as the website:
- only a **`Confirmed`** booking;
- only once the **event has started** (`event_datetime <= now`);
- only when **nothing is owed**.

The Operations Manager cannot read payments, so `v_booking_money` shows every booking as
still owing everything. Don't use it for this. Call the new function:

```js
const { data } = await supabase.rpc('f_completion_check', { p_booking_id: bookingId });
// data = { can_complete, reason, message, outstanding, event_started, status }
// reason: null | 'not_confirmed' | 'event_not_started' | 'balance_due'
```

1. Call it when a booking opens (and after any refresh). If `can_complete` is false,
   show **Complete** disabled with `data.message` under it, e.g. *"The event is on Oct
   10, 2026 1:00 PM."* or *"₱4,250.00 balance still due."*
2. When Complete is pressed and allowed, do all three, then reload:
   - `booking`: `booking_status = 'Completed'`, `status_order = 4`;
   - every `booking_equipment` row for the booking: `returned = true`,
     `returned_at = now` (and `returned_quantity` / `return_checked_at` if you record
     them);
   - every `vehicle_assign` row for the booking: `assignment_status = 'Completed'`.
3. **Equipment returns** are saved only once the event has started. Before that, hide or
   disable Return and say *"Equipment can be returned once the event has started."* The
   app can't change an allocation's item, booking or quantity. Allocation is done on the
   website.
4. **Trips** (`vehicle_assign`): `assignment_status` can change only once the trip's
   window has started (`window_start`, falling back to `dispatch_datetime`). Before that,
   hide or disable Close trip. The app can't move a trip to another vehicle, booking or
   time. Show `Scheduled` as **Assigned** before the window and **In Use** after it
   starts, and `Completed` as **Returned**.
5. A booking can have **two trips per vehicle** (setup run and collection run). Never use
   `.single()` on (booking_id, vehicle_id), and don't count trips as vehicles.
6. Vehicles and equipment are **assigned automatically when the manager approves a
   booking**. The app must not create assignments.
7. **Cancelling** a booking (customer or manager) **deletes** its `booking_equipment` and
   `vehicle_assign` rows. Refetch instead of holding them in memory.

## 3. Main Cook (Kitchen) app

No required changes. Reminders:
- `booking.menu_selections` has a different shape per `booking_type`: an **array** of
  `{menu_item_id, quantity}` for `Short Order`, an **object** keyed by category for
  `Package`. Branch on `booking_type` first.
- Don't write `booking_status`. If the app ever does, the rules in "How the database
  behaves now" apply.
- Read business details from `business_profile` if the app shows PG's name or contact.

## 4. Test before you ship

Use test accounts, not real customers.

Customer app:
- [ ] New booking saves as Pending. After the manager approves it, price, pax, date and
      venue are read-only in the app. Cancel works from Pending, Approved and Confirmed.
- [ ] GCash or bank payment: details come from `payment_account`, the proof uploads to
      `payments/`, the payment shows as Awaiting verification, and the booking turns
      Confirmed after the manager verifies 50%.
- [ ] A lapsed booking shows no Pay / Confirm action.
- [ ] A Blocked account can't book or pay and sees the contact message.
- [ ] The Terms and Privacy links open. Contact details match Settings → Business
      Details on the website.

Operations Manager app:
- [ ] A Confirmed booking whose event is in the future shows Complete disabled with the
      event date.
- [ ] A past, unpaid Confirmed booking shows Complete disabled with the balance due.
- [ ] A past, fully paid Confirmed booking completes, and its equipment shows Returned and
      its trips Completed. The website shows the same.
- [ ] Return and Close trip are not available before the event or trip starts.

Main Cook app:
- [ ] The prep list is filled in for both a Package and a Short Order.
