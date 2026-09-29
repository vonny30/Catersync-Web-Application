# CaterSync — security changes, and what they mean for the mobile apps

**Date:** 29 September 2026
**From:** the web admin side
**Short version:** nothing you do today should break. Every rule below was checked
against the requests the customer, Operations Manager and Main Cook apps actually
sent during the 27 September testing day, and re-tested as each of those accounts.
Three small additions are requested at the end.

---

## 1. What changed in the database

| Change | Why | Effect on the apps |
|---|---|---|
| Removed the policy that let **any signed-in user insert themselves into `manager`** | A customer could make themselves a manager and see everything | None — no app writes to `manager` |
| Removed the **signed-out** insert policies on `booking`, `customer`, `payment` | Anyone with the public key could create bookings for any customer, spam customers, or attach payments to other people's bookings | None — every app insert on 27 Sep was made signed in |
| **Booking guard** (trigger) | Customers could create a booking already `Confirmed`, or set the total of a confirmed booking to ₱1 | See §2 |
| **Customer guard** (trigger) | A blocked customer could un-block themselves | Profile edits save as before; `account_status`, `source`, `status_reason`, `user_id` can't be changed from the app |
| **Payment guard** (trigger) | A customer could insert a payment already `Fully Settled`, which auto-confirmed the booking | See §3 |
| **Storage** | Anyone, signed out, could upload, overwrite, list or delete every file in `images`, including all payment proofs | See §4 |
| Trigger-only functions are no longer callable through `/rpc` | Housekeeping | None — the apps only call `is_main_cook`, which still works |

## 2. Bookings

A customer can still:

- create a booking — it is always saved as **`Pending`** whatever status is sent
- edit their own booking while it is **`Pending`** (pax, date, venue, menu, total)
- **cancel** their own booking (`Pending`, `Approved` or `Confirmed` → `Cancelled`)
- edit `notes` / `motif_color` at any time

Once a booking is no longer `Pending`, its price and event details can only be changed
by the manager. Changes to those fields from the app are **silently kept at their old
values**, not rejected, so a screen that sends the whole record back still saves.

The Operations Manager app can still mark a booking **`Completed`** (from `Approved` or
`Confirmed`) and update equipment returns, vehicle assignments and vehicle status. It can
no longer change a booking's price, customer or event details.

## 3. Payments

- A payment from the customer app is always saved as **`Pending Verification`**,
  entry type `Receipt`, whatever the app sends.
- `amount_paid` must be greater than zero — otherwise: `Enter an amount greater than zero.`
- The booking must belong to the customer — otherwise: `This booking does not belong to your account.`

## 4. File uploads (`images` bucket)

- Signed-in app users can upload into **`payments/`** only. That is the only folder the
  app used. Uploads anywhere else are refused.
- Allowed types: JPEG, PNG, WebP, GIF, HEIC/HEIF and PDF. Max **10 MB** (avatars: images only, 5 MB).
  If you upload without a content type, set `contentType: 'image/jpeg'` (or the real type) on the upload.
- The bucket is still public, so every existing `getPublicUrl()` link keeps working.
  What changed is that payment and refund proofs can no longer be **listed** through the
  API by anyone except the manager and the person who uploaded them.

## 5. Please add (small)

1. **Privacy Notice and Terms at sign-up.** Add a line under the sign-up button:
   *"By creating an account you agree to our Terms of Service and Privacy Notice."*
   linking to:
   - `https://catersync-web-application.vercel.app/privacy`
   - `https://catersync-web-application.vercel.app/terms`
   Also add both links to the profile / settings screen.
2. **Blocked accounts** (from the 17 Sep note, if not done yet): on sign-in and before
   submitting a booking, read `customer.account_status`; if `Blocked`, stop with
   *"This account can't place bookings right now. Please contact PG's Catering."*
3. **Walk-in customers** created at the counter now get their own one-time password
   (e.g. `Cs-7KMX-4QPT9!`) instead of the shared `Password123!`. A change-password
   screen, or the Forgot Password flow, lets them set their own.

## 6. Optional, later

Payment proofs are still reachable by anyone who has the exact link. To close that too,
make the `images` bucket's `payments/` and `refunds/` folders private and show them with
`createSignedUrl()` instead of `getPublicUrl()`. That needs a matching change in both the
app and the web, so it has not been done.
