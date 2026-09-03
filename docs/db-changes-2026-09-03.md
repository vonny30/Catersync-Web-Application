# Database changes — 3 Sep 2026

**Read this if you work on any CaterSync app.** Four Row Level Security policies
were removed from the shared Supabase project today. Nothing was added, no table
or column changed, and no data was touched.

If a mobile screen stops returning rows after today, this is the first place to
look — and §5 is the one-command revert.

Project: `qreuaphaxvfayxqqniqg` — *Capstone Project - Catersync*
Migration: `close_anon_read_and_write_holes_on_booking_customer_payment`

---

## 1. What was wrong

The Supabase **anon key is inside every client bundle by design** — web and
mobile. It is not a secret and never was. What makes that safe is Row Level
Security deciding what the `anon` role may actually do.

Four policies gave `anon` unrestricted access:

| Table | Policy | Command | Rule |
|---|---|---|---|
| `booking` | Owner can update booking status | **UPDATE** | `USING (true)` |
| `booking` | Customers can view bookings | SELECT | `USING (true)` |
| `customer` | Customers can view customer records | SELECT | `USING (true)` |
| `payment` | Customers can view payments | SELECT | `USING (true)` |

`anon` means anyone on the internet holding the key — which is everyone, since
it ships in the app.

**The UPDATE was the serious one.** Its `WITH CHECK` constrained only
`booking_status`, so every *other* column stayed writable: `total_amount`,
`venue`, `event_datetime`, `pax_count`. Anyone could set any booking's total to
zero, and nothing would have recorded who did it.

The three SELECTs exposed every customer's name, address and contact number,
every booking, and every payment.

---

## 2. Why removing them is safe

**Every one is redundant.** Correctly scoped policies already existed alongside
them and are untouched:

| Table | The scoped policy that remains | Who it lets in |
|---|---|---|
| `booking` | Customers can view their own bookings | signed-in customer, own rows |
| `booking` | Customers can update their own bookings | signed-in customer, own rows |
| `customer` | Customers can view their own profile | signed-in customer, own row |
| `payment` | Customers can view their own payments | signed-in customer, own rows |

Plus `Manager full access` on all three, and the `is_main_cook()` /
`is_operations_manager()` policies for staff.

**And customers really do sign in.** Checked before changing anything:

```
auth.users                     24
customer rows                  21
customer rows linked to auth   21   ← all of them
```

Every customer has an auth account, so the `authenticated` policies cover the
whole customer base. The `anon` policies were leftovers from before auth was
wired up.

---

## 3. What was deliberately left alone

These still allow `anon` and were **not** touched:

| Table | Policy | Why it stays |
|---|---|---|
| `menu_item`, `category`, `package`, `package_category` | catalogue reads | Browsing the menu before signing in is intended |
| `booking` | Customers can submit pending bookings | INSERT, `WITH CHECK booking_status = 'Pending'` — the request path |
| `payment` | Customers can submit payment proof | INSERT, `WITH CHECK pay_status = 'Pending Verification'` — the proof path |
| `customer` | Customers can create customer records | INSERT, `WITH CHECK true` — registration. **See below.** |

**One still open, for the mobile team to decide.** `Customers can create
customer records` lets anyone insert a customer row. That is abuse potential
(junk rows), not data exposure, so it is less urgent — but it should probably be
scoped. It was left because breaking registration days before a defence is worse
than the risk, and because `sync_current_customer()` (a `SECURITY DEFINER` RPC)
may already be the real registration path, in which case this policy is unused
and can simply go.

**Please confirm what your registration flow actually calls**, then either drop
the policy or replace it with the `authenticated` version that already exists
(`Customers can create their own profile`, checking `user_id = auth.uid()`).

---

## 4. What to test on mobile

Everything here should still work. If any of it fails, say so before reverting —
the cause is more likely a missing sign-in than the policy change itself.

1. **Browse packages and menu items without signing in** — should still work.
2. **Register a new customer** — should still work.
3. **Sign in, view your own bookings** — should work. If this returns nothing,
   the app is reading as `anon` after login; the fix is to use the authenticated
   Supabase client, not to restore the policy.
4. **Sign in, view your own payments** — same.
5. **Submit a booking request** — should still work (INSERT path untouched).
6. **Upload payment proof** — should still work (INSERT path untouched).
7. **Cancel your own booking** — should work while signed in.
8. **Try to view another customer's booking** — should now return nothing. That
   is the point of the change.

The web admin app is unaffected: it signs in as a manager, and
`Manager full access` was not modified.

---

## 5. How to revert

Run this in the Supabase SQL editor. It recreates all four exactly as they
were, verbatim from `pg_policies` before the change:

```sql
create policy "Owner can update booking status"
  on public.booking for update
  to anon, authenticated
  using (true)
  with check (
    (booking_status)::text = any ((array[
      'Pending','Approved','Ongoing','Preparing',
      'Out of Delivery','Completed','Cancelled','Rejected'
    ])::text[])
  );

create policy "Customers can view bookings"
  on public.booking for select
  to anon, authenticated
  using (true);

create policy "Customers can view customer records"
  on public.customer for select
  to anon, authenticated
  using (true);

create policy "Customers can view payments"
  on public.payment for select
  to anon, authenticated
  using (true);
```

Reverting restores the exposure described in §1. If one screen is broken, fix
that screen rather than reverting all four — and revert the three SELECTs before
the UPDATE, which is the one that lets strangers rewrite your money.

---

## 6. Two things found while looking, not changed

**The fleet is 3 cars and 1 motorcycle**, not the "three cars and two
motorcycles" in the capstone §1.1, and not the "3 vehicles" assumed in
conversation. Both were right about different things: `EVENT_SETUP_DEFAULT_VEHICLES = 3`
is correct because the three **cars** do event setups, and motorcycles do
deliveries. Worth adding the missing motorcycle if PG's has two, or correcting
the document if they have one.

**`is_operations_manager()` already exists** and has read policies on `booking`,
`booking_equipment`, `equipment`, `vehicle`, `vehicle_assign`, `customer`,
`menu_item`, `package`, `package_equipment` and `category`, plus update policies
on `booking`, `booking_equipment`, `equipment`, `vehicle` and `vehicle_assign`.
The Operations Manager app has its database side ready. See
`docs/ops-manager-sync.md`.

Supabase's own linter also flags `is_main_cook()`, `is_operations_manager()` and
`sync_current_customer()` as `SECURITY DEFINER` functions callable by `anon` via
`/rest/v1/rpc/...`. The first two only return a boolean about the caller, so the
exposure is small, but revoking `EXECUTE` from `anon` on all three would be
tidier. Not done — it needs a check that nothing calls them pre-login.
