# Batch 4 — Two wrong-money bugs on the Payments page

Both are on `src/pages/Payments.jsx`. One is a display bug that prints a
nonsensical figure; the other is an arithmetic disagreement that makes money
uncollectable. Do not touch any other file except where §4.2 explicitly allows
`src/utils/payments.js`.

---

## 4.1 · "Kept from cancelled bookings" can render as "+ ₱-5,000"

**`src/pages/Payments.jsx:1405-1407`**

```jsx
{received.retainedFromCancellations !== 0 && (
  <p className="text-[12.5px] text-amber-700 mt-1">
    + ₱{received.retainedFromCancellations.toLocaleString()} kept from cancelled bookings
  </p>
)}
```

`utils/reportMetrics.js:127` defines `retainedFromCancellations = sum(cancelledRows)`
— a plain net sum over payments on cancelled/rejected bookings. It goes
**negative** whenever the period contains a refund on a cancelled booking but
not the original payment that is being refunded.

`Dashboard.jsx:892` and `Reports/FinancialTab.jsx:68` both guard the same field
with `> 0`. Payments is the only one of the three using `!== 0`, and it prints a
hardcoded `+` in front.

**Trigger:** a September cancellation refunds ₱5,000 that was taken in August.
Under the default This Month filter the only cancelled-booking row in range is
the −₱5,000 refund, so the card reads **"+ ₱-5,000 kept from cancelled
bookings."**

**The fix is not simply to copy `> 0`.** That would hide a real fact: in that
period, money went *out* on cancelled bookings. Handle both signs and say which
one is happening:

| `retainedFromCancellations` | Show |
|---|---|
| `> 0` | `+ ₱X kept from cancelled bookings` (as today) |
| `< 0` | `− ₱X refunded on cancelled bookings` — same amber treatment, absolute value, no `+` |
| `= 0` | nothing |

Use the absolute value in the negative case so the sign is carried by the word
and the `−`, never by a minus buried inside the number. Check whether
`Dashboard.jsx` and `FinancialTab.jsx` can hit the same negative case — if they
can, their `> 0` guard is silently swallowing it, and they should get the same
two-branch treatment rather than the current silence. Report what you find; make
the change in all three if it applies.

**Acceptance:** construct a period containing only a refund on a cancelled
booking. The card reads `− ₱5,000 refunded on cancelled bookings`. Construct one
with a retained payment and no refund: unchanged from today. Neither case prints
a `+` before a negative number anywhere in the app.

---

## 4.2 · Two different definitions of "remaining balance", one screen apart

**`src/pages/Payments.jsx:657-665` (`getRemainingBalance`) vs `:776-806` (`handleSubmit`)**

`getRemainingBalance` sums **all** non-unverified rows:

```js
+ (p.amount_paid || 0)
```

so negative refund rows *increase* the remaining balance it reports.

`handleSubmit` computes the same quantity with `sumVerifiedPositivePayments`,
which drops refunds entirely.

These two numbers are not internal details — the first drives the booking
dropdown, the live "Remaining: ₱X" text, the preview panel and the "Max: ₱X" hint
at `:2555`; the second decides whether the payment is accepted. The comment at
`:652-656` explicitly promises the hints match what will be accepted. They don't.

**Trigger:** booking total ₱10,000, ₱10,000 verified, ₱3,000 refunded. Every hint
on the form says ₱3,000 is collectible. Submitting ₱3,000 is rejected with *"This
booking is fully paid — there's no balance left to record against."* The manager
is shown money they cannot record.

### Decide which definition is correct, then use it in both places

This is the part that needs judgement rather than a mechanical edit, so reason it
through explicitly before you write code, and put the reasoning in a comment.

The question is what a refund means for what the customer still owes. A refund is
money returned — so if a customer paid ₱10,000 and ₱3,000 came back, they have
net paid ₱7,000 against a ₱10,000 booking, and ₱3,000 *is* outstanding.
**`getRemainingBalance`'s treatment is the correct one**; `handleSubmit`'s is the
one to change.

But verify that against the rest of the system before committing to it —
specifically check how `Outstanding Balance` and the Reports `outstanding` figure
treat refunds today. If they net refunds (they should, by the same argument),
then making `handleSubmit` net them too brings all four into agreement. If they
don't, say so and stop: three inconsistent definitions is a bigger decision than
this batch, and I'd rather know than have you pick one.

**Then:** extract the single agreed definition into `src/utils/payments.js` as one
exported function, and have both `getRemainingBalance` and `handleSubmit` call it.
Two copies of this rule in one file is how they drifted apart; leaving two copies
that currently agree just resets the clock.

**Acceptance:**

1. Booking with ₱10,000 total, ₱10,000 paid, ₱3,000 refunded: the dropdown, the
   preview, the Max hint and the submit validation all agree that ₱3,000 can be
   recorded, and recording it succeeds.
2. Booking fully paid with no refunds: still correctly refused, with the existing
   message.
3. A refund larger than the payments on a booking does not produce a remaining
   balance above the booking total, and does not allow recording more than the
   total.
4. The Outstanding Balance card and its modal still agree with each other after
   the change, and with the Reports figure for the same period.
5. Both call sites are the same function. Grep to prove there is one definition
   left, not two.

## Do not

- Do not change `isUnverifiedPayment`, `UNVERIFIED_PAY_STATUSES`, or
  `sumVerifiedPositivePayments` itself — other pages depend on them meaning what
  they mean today. Add the new function beside them.
- Do not change how refunds are recorded or which tab they appear in.
- Do not touch `reportMetrics.js` in 4.2.
