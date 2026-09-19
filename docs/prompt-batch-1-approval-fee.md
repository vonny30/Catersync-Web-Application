# Batch 1 — Stop the Bookings list from erasing the approval fee

**Do this one on its own and push it before starting anything else.** It is the
only finding in the audit that destroys money on a routine action.

Files you may touch: `src/pages/Bookings.jsx`. Nothing else.

---

## The bug

At approval, `useApprovalHandlers.handleFinalizeApproval` folds the manager's
additional fee and any extra-pax cost into `booking.total_amount`. `Approved` is
**not** in `PAYMENT_LOCKED_STATUSES`, so the Edit button on the Bookings list
stays live for an approved booking.

Opening that Edit form runs the auto-calculate effect at `Bookings.jsx:122-148`,
which unconditionally does:

```js
setFormData(prev => ({ ...prev, total_amount: baseTotal.toFixed(2) }));
```

where `baseTotal` is the bare package × pax recomputation. Saving writes that
number back at `:944`. The approval fee is gone — from the booking, from
Outstanding Balance, from Estimated Gross Revenue, from every report.

**`utils/payments.js` exports `totalLossOnRecompute` for exactly this**, and it
is already called in all three sibling files:

- `ShortOrders.jsx:574`
- `ShortOrderDetails.jsx:561`
- `BookingDetails.jsx:602`

`Bookings.jsx:23` imports only `isPaymentLedgerLocked` and
`formatPaymentDeletionWarning`. It is the one file of the four with no guard.

**Reproduce:** approve a booking with a non-zero "Other Fees" adjustment, record
a payment against it, then open Edit **from the Bookings list** (not from the
booking's own page), change nothing but the venue, and save. Compare
`total_amount` before and after. Doing the same from the Details page is
correctly refused with a toast.

---

## The fix

Add the same guard the other three files use. Read
`ShortOrders.jsx:560-590` first and copy that shape — do not invent a different
approach, because four near-identical guards that differ in wording is how this
drifts again.

1. **`Bookings.jsx:23`** — add `totalLossOnRecompute` and `totalLossLockedMessage`
   to the existing import from `../utils/payments`.

2. **In the submit handler, before the update payload is built** (around `:944`),
   compute the recomputed total the same way the effect does, and refuse the save
   when it would lose money against the stored total:

   ```js
   if (editingId && totalLossOnRecompute(storedTotal, recomputed) > 0) {
     toast.error(totalLossLockedMessage(...));   // match ShortOrders.jsx's call
     setIsSubmitting(false);
     return;
   }
   ```

   `storedTotal` must be the booking's **saved** `total_amount` as loaded from the
   database, not `formData.total_amount` — the effect has already overwritten the
   form value by the time the handler runs, so comparing the form against itself
   would always pass. Find the original row in the page's existing bookings array
   by `editingId`.

3. **Guard the effect too**, so the manager never sees the lower figure appear in
   the field in the first place. The effect at `:122` should not overwrite
   `total_amount` when editing a booking whose stored total already exceeds the
   recomputed base — that difference is the approval fee and it is not the form's
   to recalculate. A new booking (no `editingId`) keeps the current behaviour
   unchanged.

   This half matters: without it the manager watches ₱58,000 turn into ₱50,000 on
   screen and is then told they can't save, which reads as the form being broken
   rather than as a rule protecting them.

---

## Acceptance

1. Approve a booking with a ₱5,000 additional fee so its stored total is above
   package × pax. Open Edit from the **list**. The Total field still shows the
   stored total, not the recomputed base.
2. Change the venue only and save. It saves, and `total_amount` is unchanged in
   the database.
3. Change pax count so the recomputed base legitimately rises above the stored
   total. It saves and the total updates — the guard must only block a **loss**,
   never a legitimate increase.
4. A brand-new booking (Add, not Edit) still auto-calculates its total exactly as
   it does today. Verify this specifically; it is the behaviour most likely to be
   broken by a careless guard.
5. The refusal message matches the wording the other three pages already use —
   compare side by side with the same action attempted from the Details page.

## Do not

- Do not remove the Edit button for Approved bookings, and do not add `Approved`
  to `PAYMENT_LOCKED_STATUSES`. Approved is deliberately the window in which a
  booking can still be adjusted; the problem is the silent recalculation, not
  that editing is allowed.
- Do not change `utils/payments.js`, `useApprovalHandlers.js`, or any of the
  three sibling pages.
- Do not change how a new booking's total is calculated.
