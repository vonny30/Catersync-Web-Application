# Fixed-price packages: a headcount the package actually covers

3 Sep 2026. Decided with Vaughn; written before any code so the rule is settled
in one place rather than discovered in four.

---

## 1. The rule

A **fixed-price** package covers a headcount **band**, not an open-ended number:

> `minimum_pax ≤ pax_count ≤ max_pax`

Inside the band the price is always `pkg_price`. Outside it the booking is
**refused**, the same way a booking below `minimum_pax` is refused today.
Equipment continues to allocate on `pax_count` — which is now bounded, so the
inclusions are bounded with it. That is what makes a fixed package genuinely
fixed.

**Per-pax packages are unchanged.** They have no `max_pax` (the package form
already nulls it for them) and no upper bound; their price scales with
headcount, so there is nothing to cap.

### Why a hard cap rather than an overage charge

Granite is ₱5,000 flat. With equipment allocating per guest — 1 chair and
1 chafing dish each, 1 buffet table per 6 — an unbounded fixed package is an
unbounded cost against a fixed price. The alternatives were charging per extra
head (contradicts "fixed") or capping the gear while taking the booking
(guests arrive to no chair). Refusing the booking is the only one of the three
that keeps the promise the price makes.

---

## 2. What already exists

**`package.max_pax` is built.** Nothing needs adding to the schema.

| Where | What it already does |
|---|---|
| `package.max_pax` | `integer`, nullable |
| `PackagesAndMenus/index.jsx:608` | writes it **only** for `pricing_type === 'fixed'`, nulls it otherwise |
| `PackagesAndMenus/index.jsx:434-442` | validates it is ≥ 1 and not below `minimum_pax` |
| `ItemFormModal.jsx:217` | the input, labelled **Max Pax Included** |
| `PackageCard.jsx:82-85` | shows it on fixed packages |
| `BookingDetails.jsx:1428` | shows "(up to N pax)" |

It is simply **null on every package**, so every guard that reads it
short-circuits and it has never done anything.

---

## 3. What is missing — four things

### 3.1 `max_pax` is optional, and shouldn't be for fixed packages
`index.jsx:608` reads `parseInt(formData.max_pax) || null`. A fixed package
with no cap has no rule to enforce, which is exactly today's state.

→ In the same validation block as `:434-442`, refuse to save when
`pricing_type === 'fixed'` and `max_pax` is empty. Mark the input required in
`ItemFormModal.jsx` when the type is fixed.

### 3.2 The existing minimum guard is enforced in ONE of THREE write paths
This is the important one. `minimum_pax` is checked at `Bookings.jsx:773` and
nowhere else. There are three places `pax_count` is written:

| # | Path | Current pax validation |
|---|---|---|
| 1 | `Bookings.jsx:773` — create | `pax < minimum_pax` ✔ |
| 2 | `BookingDetails.jsx:744` — edit | **`pax >= 1` only** |
| 3 | `useApprovalHandlers.js:253` — approval | **none** |

So today a Granite booking created at 20 can be **edited down to 5** and saved.
And path 3 is worse: it writes `pax_count = pax_count + extraPax` and then
reallocates equipment for the new figure at `:271`. A manager approving a
55-guest Granite booking with 30 extra pax writes 85 and allocates 85 chairs —
the exact hole a cap is meant to close, in the one path that has no guard at
all.

→ **One shared validator, three call sites.** Not a fourth copy of the rule;
that pattern is what put three drifting versions of the completion filter in
the codebase.

Proposed — `src/utils/packageRules.js`:

```js
/**
 * Is this headcount allowed for this package?
 *
 * Fixed packages cover a band: minimum_pax..max_pax, priced flat inside it and
 * refused outside. Per-pax packages have a floor only — their price scales, so
 * there is nothing to cap.
 *
 * max_pax null means "no cap recorded yet" and is deliberately permissive:
 * packages created before this rule existed must keep working, and their
 * bookings must stay editable. The package form now requires a cap on new and
 * edited fixed packages, so null drains out rather than being migrated.
 *
 * Returns { ok } or { ok: false, message } — the message is shown as-is.
 */
export function validatePaxForPackage(pkg, paxCount) { ... }
```

Rules, in order:

1. no `pkg` → `{ ok: true }` (nothing to check against)
2. `pax < 1` → *"Must be at least 1."*
3. `pax < pkg.minimum_pax` → *"Minimum pax for this package is {n}."* (keep the
   existing wording — it is already on screen)
4. `pkg.max_pax` set and `pax > pkg.max_pax` → *"{pkg_name} covers up to {n}
   guests. Choose a per-pax package for a larger event."*
5. otherwise `{ ok: true }`

Call it from all three paths. Path 3 must validate
`pax_count + extraPax`, **before** the write at `:253` and before the
reallocation at `:271` — not after.

### 3.3 A hard cap makes `extra_pax_price` dead
If `pax` can never exceed `max_pax`, then

```js
total += (pax - pkg.max_pax) * (pkg.extra_pax_price || 0);
```

is unreachable. It appears four times: `useApprovalHandlers.js:86-87`,
`BookingDetails.jsx:579-580` and `:693-694`, `Bookings.jsx:128-129`.

It is already unused for per-pax packages — `extraPaxRate` returns `pkg_price`
for those — so under this rule `extra_pax_price` has no reader anywhere.

→ Hide the **Extra Pax Price** input (`ItemFormModal.jsx:230`) when the type is
fixed, and hide the **Extra Pax (additional guests)** input at approval
(`Bookings.jsx:2241` and the matching one on the other approval panel) for
fixed packages, forcing `extraPax` to 0. A field that cannot change the total
should not be on screen asking for a number.

**Leave the four pricing lines and the column in place.** They are now dead but
harmless, and deleting a money calculation in the same change that adds a
booking guard makes the diff hard to reason about. Remove them separately, or
not at all.

### 3.4 The customer app books packages too
This is a **booking rule**, not a web-admin rule. If the web app starts refusing
above the cap and the customer app does not, customers submit bookings that get
rejected at approval — and the rejection reads as PG's changing its mind.

→ Goes to the mobile developer with the rule, before this ships, not after.
Same validator logic, same message. Recorded in §5 for that purpose.

---

## 4. Existing data

| Package | Type | Price | min | max | Bookings | Booked range |
|---|---|---|---|---|---|---|
| Granite | fixed | ₱5,000 | 20 | **null** | 2 | 50–55 |
| Bronze | per_pax | ₱250 | 50 | null | 9 | 50–80 |
| Gold | per_pax | ₱300 | 50 | null | 1 | 50 |
| Silver | per_pax | ₱350 | 30 | null | 0 | — |

**No number is being set for Granite in this change.** Vaughn's instruction is
to make the cap a *requirement of the form* so every fixed package declares one,
rather than have a value guessed here. He will set Granite's through the UI once
the field is required.

**Which is why rule 4 must tolerate `max_pax = null`.** Granite has two live
bookings at 50 and 55; if a null cap refused everything, or if a cap below 55
were set, those two would fail validation the moment anyone opened them to edit.
Null means "no cap recorded", not "cap of zero".

→ Whatever Granite's cap becomes, **it must be ≥ 55** or those two bookings
become unsavable.

### Worth flagging separately
Granite is ₱5,000 for the 50–55 guests it has actually been booked for — about
₱91 per head, against Bronze at ₱250. That is a large gap for seed data to have
by accident. Worth confirming with PG's that ₱5,000 is the real price before it
is defended.

---

## 5. For the mobile developer

**New booking rule, applies to the customer app as well as web:**

- A package booking's headcount must satisfy
  `minimum_pax ≤ pax_count ≤ max_pax`.
- `minimum_pax` is `NOT NULL` on every package and always applies.
- `max_pax` is set **only on fixed-price packages** (`pricing_type = 'fixed'`).
  It is `null` on per-pax packages, and null means **no upper limit** — do not
  treat null as zero.
- A fixed package's price is `pkg_price` regardless of headcount inside the
  band. There is no per-head surcharge; ignore `extra_pax_price`.
- Suggested message above the cap:
  *"{pkg_name} covers up to {max_pax} guests. Choose a per-pax package for a
  larger event."*

Validate before submitting. A request that violates this will be rejected at
approval, which the customer sees as a cancellation rather than a form error.

---

## 6. Revert

- `src/utils/packageRules.js` is a new file — delete it.
- Three call sites revert to what they had: `Bookings.jsx:773` its inline
  minimum check, `BookingDetails.jsx:744` its `>= 1` check, and
  `useApprovalHandlers.js` no check.
- The form changes are two conditional renders and one validation branch.
- No schema change, no migration, no stored value altered. `max_pax` stays
  nullable and every existing row keeps its current value.
