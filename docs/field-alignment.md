# One table, two products: which fields belong to which

4 Sep 2026. Vaughn's rule, applied to the schema and to every add/edit modal:

> **Keep the shared tables. Fill only the fields that belong to the record's own
> type.**

`booking` holds both package bookings and short orders; `package` holds both
fixed and per-pax pricing. That sharing is a deliberate design and worth
defending — but only if each row carries the fields its type actually uses, and
only if the add form and the edit form agree about what those are.

Checked against live data and all three modal files. **The forms are in better
shape than the schema.** One field is filled for exactly the wrong type, one
column carries two different data structures, and two modals disagree with each
other about a fee.

---

## 1. `package.extra_pax_price` — filled for the one type that can't use it

`PackagesAndMenus/index.jsx:619`:

```js
extra_pax_price: formData.pricing_type === 'fixed' ? (parseFloat(...) || 0) : null,
```

Written for **fixed**, nulled for **per-pax**. Both are backwards:

- A **fixed** package now covers a band (`docs/fixed-package-cap.md`). There is
  no "beyond the cap" to charge for — a headcount outside the band is refused,
  not surcharged. Nothing can read this value.
- A **per-pax** package charges `pkg_price` for every guest, including extra
  ones. `extraPaxRate` in `useApprovalHandlers.js:24-29` returns `pkg_price` for
  that branch and never looks at this column.

So it has no reader on either side. By the rule it should be filled for
**neither**.

### Change

- `index.jsx:619` → `extra_pax_price: null` for both types (or drop the key).
- Remove the **Extra Pax Price (₱)** input from `ItemFormModal.jsx:230` and the
  validation branch at `index.jsx:455-462` that guards it.
- `PackageCard.jsx:21` computes `showExtraPax` from it — that block goes too.
- `BookingDetails.jsx:1435-1436` renders "· ₱{extra_pax_price}" beside the
  package name; remove.

### Leave alone

**Keep the column.** Dropping it is a migration for no benefit, and a nullable
unused column costs nothing. Keep the four
`total += (pax - max_pax) * extra_pax_price` lines too
(`useApprovalHandlers.js:88`, `BookingDetails.jsx:581` and `:695`,
`Bookings.jsx:131`) — they are unreachable once the value is always null, and
deleting money arithmetic is a separate change with a separate review.

### Why this matters beyond tidiness

The field was one input away from a live overcharge. On a fixed package, the
approval modal's Extra Pax charged `extra_pax_price` per head **and** added
those heads to `pax_count`, without re-running the `max_pax` comparison. Below
the cap that is a pure overcharge:

> ₱5,000 package, `max_pax` 50, `extra_pax_price` ₱400.
> Customer books 40 → ₱5,000, correct.
> Manager types Extra Pax 5 → ₱7,000, `pax_count` 45.
> Honest recomputation at 45: **₱5,000.** Forty-five is still inside the band.

It never fired because Granite's `extra_pax_price` is ₱0.00. Setting a real
number would have switched it on. Hiding the input (commit `b71bb62`) closed the
path; emptying the column removes the bait.

---

## 2. `booking.menu_selections` — one column, two data structures

Not a rule violation — a **polymorphic column**, and the sharpest thing in this
document.

```
Short Order   [{"menu_item_id": "…", "quantity": 2}]      array  — trays ordered
Package       {"<category_id>": "<menu_item_id>", …}      object — one dish per category
```

Verified against `category`: the object keys are category ids. Ten package
bookings carry Beef and Seafood; others carry Chicken, Pork, Dessert. For a
package it means *which dish the customer chose in each category*; for a short
order, *what trays they ordered and how many*.

**Nothing is broken today**, but only because `Reports/index.jsx:392` guards
with `Array.isArray(b.menu_selections) ? … : []`, so a package row falls through
to empty. That is a guard catching it, not a design holding it.

**Do not split the column.** Days before a defence, a migration touching every
booking is exactly the wrong trade. Document it and move on.

### Where it will bite

**PR-32, the Dishes Prepared view** — decided, not built. Its job is expanding
packages into component dishes, which live in the object shape. Written against
the short-order parser it silently shows nothing for every package.

**The Main Cook app** — reads what the kitchen must prepare, for both types, and
will meet both shapes. `.map()` over an object does not throw; it yields
nothing. An empty prep list with no error is the worst failure available here.

Both are ahead of you, not behind. §5 is written for the mobile developer.

---

## 3. The add/edit modals

Three files hold them — `Bookings.jsx` (add **and** edit for packages),
`BookingDetails.jsx` (edit), `ShortOrders.jsx` (add and edit),
`ShortOrderDetails.jsx` (edit). Dashboard has an approval panel only.

| Field | Bookings | BookingDetails | ShortOrders | ShortOrderDetails |
|---|---|---|---|---|
| `customer_id` | ✔ | ✔ | ✔ | ✔ |
| `package_id` | ✔ | ✔ | — | — |
| `pax_count` | ✔ | ✔ | — | — |
| `motif_color` | ✔ | ✔ | — | — |
| `menu_selections` | `{}` | `{}` | `[]` | `[]` |
| `total_amount` | ✔ | ✔ | derived | ✔ |
| `delivery_fee` | **—** | **✔** | ✔ | ✔ |
| `booking_type` | ✔ | ✔ | ✔ | **—** |

**The type-specific fields are already correct.** `package_id`, `pax_count` and
`motif_color` appear on package forms only; the two `menu_selections` shapes
match their types. Whoever built these followed the rule without it being
written down.

Three things do not line up.

### 3.1 Delivery Fee is on the package EDIT form but not the package ADD form
`BookingDetails.jsx:70` carries `delivery_fee: '0'` with an input at `:1987`,
and `:686` adds it into the edit total. `Bookings.jsx` has no such field, and
its payload says so out loud at `:922` — `// Build payload (no delivery_fee)`.

So a package booking cannot be given a delivery fee when it is created, only
when it is later edited from the detail page. The total quoted at creation
(`:118-140`) can never include one.

Nothing is lost — an omitted key in a Supabase update leaves the column
untouched, so editing from the list page does not wipe a fee set on the detail
page. But the two forms disagree about whether the field exists.

**Decided 4 Sep (Vaughn): a package booking does not carry a delivery fee.**
The ADD form was right; the EDIT form is the one to change. A package event is
priced as one contract at a venue, and any travel is inside that price — the
delivery fee belongs to short orders, which are sold and delivered by the tray.

All twelve package bookings already hold ₱0, so nothing on screen changes and no
data needs correcting.

→ Remove the field from `BookingDetails.jsx`, all nine sites:

| Line | What it is |
|---|---|
| `70` | `delivery_fee: '0'` in `editFormData` |
| `584` | display total — `return total + (parseFloat(booking.delivery_fee) \|\| 0)` |
| `613` | loads the stored value into the edit form |
| `687` | `const deliveryFee = parseFloat(editFormData.delivery_fee) \|\| 0` |
| `698` | `total += deliveryFee` |
| `700` | `editFormData.delivery_fee` in the `useMemo` dependency array |
| `819` | `delivery_fee: …` in the save payload |
| `1987–1991` | the label and the input |

**Omit the key at `:819` rather than writing 0.** The column is nullable with
`DEFAULT 0`, so a package booking created without it already gets 0 — which is
why `Bookings.jsx` has never needed the field. Not writing a column the type
does not use is the rule itself, applied.

Nothing else reads it for a package: `Reports/index.jsx:403` only sums delivery
fees inside `shortOrderBookings.forEach`, and `Dashboard.jsx:239` selects it
under `.eq('booking_type', 'Short Order')`.

### 3.2 `total_amount` is held differently in the two short-order forms
`ShortOrders.jsx` has no `total_amount` in `formData` and derives
`computedTotal` in a `useMemo` at `:444-450` (items + delivery fee).
`ShortOrderDetails.jsx:56` holds `total_amount` in state **and** computes a
total at `:686`.

Both arrive at items + delivery fee, so the figures agree today. But one form
has a stored value that could drift from the computed one.

→ Confirm which value the edit path actually writes, and if the stored one is
unused, drop it from state so there is one source.

### 3.3 `booking_type` is missing from `ShortOrderDetails`' edit state
The other three carry it. Harmless — an edit never changes the type — but it is
the sort of asymmetry that makes a reader wonder whether it was forgotten.

→ Add `booking_type: 'Short Order'` for symmetry, or remove it from the other
three. Cosmetic either way.

---

## 4. One leak the web app did not cause

`pax_count` is set on **four of five** short orders. Neither short-order modal
has the field, correctly — short orders are sold by the tray.

The web app is not the source. `booking.pax_count` is `integer NOT NULL` with no
default, so *something* must be supplied on every insert, and
`ShortOrders.jsx:866` supplies the honest one: `pax_count: 0`. That is this rule
handled properly under a constraint that will not allow the field to simply be
absent.

So the four rows carrying real headcounts came from the customer app, and the
fifth — sitting at 0 — is the one in the correct state.

Not a bug — nothing reads it for a short order — but it is the rule being broken
from the other side of the contract, and it belongs in §5 rather than in a web
fix.

---

## 5. For the mobile developer

Three items, all contract rather than code-in-this-repo.

**1. `booking.menu_selections` is polymorphic. Branch on `booking_type` before
parsing it.**

```jsonc
// booking_type = 'Short Order'  — array
[ { "menu_item_id": "uuid", "quantity": 2 } ]

// booking_type = 'Package'      — object, keyed by category_id
{ "14c99363-…": "136debf9-…", "f55b66a6-…": "2cb11bac-…" }
```

A package's value is the customer's chosen dish per category. Iterating it as an
array yields nothing and throws nothing — the Main Cook app would show an empty
prep list with no error. Check the shape first.

**2. Do not set `pax_count` on a short order.** Short orders are sold in trays;
headcount is not their unit and nothing reads it for them. Four of the five
existing rows have it set and one does not — the empty one is correct.

**3. `extra_pax_price` is being emptied and is no longer part of pricing.** A
fixed-price package charges `pkg_price` flat inside `minimum_pax..max_pax` and
refuses bookings outside that band (`docs/fixed-package-cap.md` §5). A per-pax
package charges `pkg_price` per guest. There is no per-head surcharge on either.
Ignore the column.

---

## 6. Revert

Everything in §1 is deletions of inputs and one changed literal; restoring them
is restoring the removed blocks. No column is dropped, no row is rewritten, no
migration runs. §3.1 is a business decision that adds or removes one field. §2
and §4 are documentation only — no code changes at all.
