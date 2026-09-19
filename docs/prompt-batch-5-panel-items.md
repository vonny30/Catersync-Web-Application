# Batch 5 — Two open panel items

Both of these trace directly to recommendations the panel made at the 1st
increment. They are the two most likely to be asked about at the 2nd, and both
are small.

---

## 5.1 · Vehicles has no return policy, and flags OVERDUE ~7 hours too early

**Panel item: Förster, PR-33 — *"What is the policy for equipment return? Right
after use? Within 12 hrs? Within 4 hrs?"***

Equipment answered this. `pages/Equipment.jsx:82-95` defines the policy and
`RETURN_POLICY_TEXT` states it to the manager on screen:

> due back **within 24 hours** of the event start · returns recordable from
> **4 hours** after · anything still out past 24 hours is **Overdue**

**Vehicles was never given the same treatment**, and still runs the rule that
Equipment fixed:

| | Vehicles | Equipment |
|---|---|---|
| Return unlocks | `Vehicles.jsx:66-70` — event + `PICKUP_GRACE_HOURS` (4h) | event + 4h |
| Flagged overdue | `Vehicles.jsx:1333` — `eventDate < now` | event + 24h |

So from the moment an event starts, the row is red, badged **Overdue**, counted
in the card, counted in the section chip, sorted to the top of the list — while
its own Return button is greyed out reading *"Locked — returns open 4 hours after
the event."* The manager is told to act on something the system refuses to let
them act on.

It is worse than a 4-hour window. `defaultPickupDispatch` (`utils/vehicle.js:644`)
*schedules* the collection run to leave at event + 4h, and `TRIP_PROFILE` gives it
travel + teardown + travel ≈ 3h. **A perfectly punctual collection run is flagged
Overdue for about seven hours while doing exactly what it was planned to do.**

### This is not one site — it is eight

Fix every one, or the badge and the count will disagree:

| Site | Line |
|---|---|
| "Overdue returns" card / trip subtitle | `1093-1097` |
| Group `isOverdue` (badge, red row tint) | `1333`, `2112`, `2116-2119` |
| Section-chip count `Overdue (N)` | `1345-1349` |
| `Overdue` filter | `1357` |
| Priority sort rank | `1337-1343` |
| Per-row `StateChip` + "Overdue N days" | `2180-2184`, `1352` |
| History tab filter + chip | `1403-1405`, `2226`, via `getTripState` (`utils/vehicle.js:574`) |
| Tab blurb stating the rule to the user | `1639` |

### The change

1. Anchor overdue to a **due time**, not the event time, exactly as
   `Equipment.jsx:95` does. `RETURN_DUE_AFTER_HOURS = 24` **already exists** at
   `utils/vehicle.js:404` and is already imported into this module — use it
   rather than declaring a new constant.
2. Write the policy down and show it, the way Equipment does. Add a
   `RETURN_POLICY_TEXT` analogue and render it on the assignments tab. Right now
   the only statement to the user is the tab blurb at `:1639` — *"Overdue means
   the event has passed with no return recorded"* — which publishes the broken
   rule as though it were the policy. That line must change.
3. Two comments currently defend the behaviour and argue the opposite of what the
   code does — `Vehicles.jsx:1091-1092` and `utils/vehicle.js:543-548` both claim
   that measuring from the event *avoids* flagging a trip during the locked
   window, when measuring from the event is precisely what creates that window.
   Correct them; do not leave a comment that will re-justify the bug to the next
   reader.
4. Match Equipment's badge detail while you're here: `OVERDUE · 3d` with the exact
   due timestamp on hover. One day late and a week late are different problems.

### The duplicate that caused this

`getReturnAvailability` is defined **twice** — `Equipment.jsx:86-90` and
`Vehicles.jsx:66-70` — identical bodies under different constant names
(`RETURN_OPENS_AFTER_MS` / `RETURN_GRACE_MS`). `utils/vehicle.js:1288-1291`
warns about this pair by name: *"the last time a rule was written down twice in
this codebase (the return grace) the copies were eight hours apart."*

Move the shared rule — both the unlock time and the due time — into
`utils/vehicle.js` as one exported pair, and have both pages import it. Nothing
prevents the next drift otherwise, and this batch exists because of the last one.

### Acceptance

- An event that started 1 hour ago: **not** Overdue anywhere — not the card, not
  the chip, not the badge, not the sort, not the History tab — and its Return
  button is still correctly locked with the existing message.
- An event that started 5 hours ago: not Overdue, Return button **unlocked**.
- An event that started 26 hours ago with no return recorded: Overdue everywhere,
  badge reads `OVERDUE · 1d`, due timestamp on hover.
- The card count, the section-chip count and the number of red rows are the same
  number in all three cases.
- The tab blurb states the real policy in the same terms Equipment uses.
- `grep -rn "getReturnAvailability" src/` returns one definition.

---

## 5.2 · The password eye icon and its label use opposite conventions

**Panel item: Curativo, PR-14 — *"Password visibility icon is incorrect."***

The **glyph** was already flipped to the state convention, which is what the
panel asked for and which is correct:

```jsx
{showPassword ? <Eye size={19} /> : <EyeOff size={19} />}
```

password visible → open eye · password hidden → slashed eye.

But the `aria-label` and `title` on the same button still follow the **action**
convention:

```jsx
aria-label={showPassword ? 'Hide password' : 'Show password'}
title={showPassword ? 'Hide password' : 'Show password'}
```

So while the password is visible, the user sees an open eye on a button whose
tooltip says *"Hide password."* The icon describes the state; the text describes
the click. A sighted user and a screen-reader user are handed opposite models of
the same control, and hovering the button during a demo shows the contradiction
directly.

### The change

Pick one convention and use it for both the glyph and the text on every password
field. **Keep the state convention on the glyph** — it is what the panel asked
for and it is already consistent — and bring the text into line with it.

For a button, an accessible name that describes state rather than action is
unusual, so do it properly rather than just swapping the strings: make the
control an explicit toggle, so the state lives in the ARIA state and the name
stays stable.

```jsx
<button
  type="button"
  aria-pressed={showPassword}
  aria-label="Show password"
  title={showPassword ? 'Password is visible' : 'Password is hidden'}
  ...
>
```

That gives a screen reader "Show password, toggle button, pressed", which matches
the open eye a sighted user sees, and gives a hover tooltip that states the same
fact the icon states. If you prefer a different resolution, take it — but the
test is that the glyph and the text must never assert different things.

### All six sites, plus one

`Login.jsx:288-292` · `ResetPassword.jsx:139`, `:162` ·
`SettingsPage.jsx:477`, `:499`, `:522` · `PasswordConfirmModal.jsx:61`

The seventh (`PasswordConfirmModal`) was not in the original PR-14 list. Include
it — a password toggle that behaves differently from the other six is exactly how
this drifts back.

### Acceptance

- On all seven fields: password hidden → slashed eye, and the hover text says it
  is hidden. Password visible → open eye, hover text says it is visible.
- No field anywhere in the app shows an open eye alongside text saying "hide", or
  a slashed eye alongside text saying "show".
- A screen reader announces the same state the glyph shows.
- The toggle still works on click and on Enter/Space.

## Do not

- Do not change the glyph convention — the panel asked for state and it is
  already correct.
- Do not change any password validation, policy or submit behaviour in 5.2.
- Do not change `PICKUP_GRACE_HOURS` or `TRIP_PROFILE` in 5.1. The unlock time is
  correct; only the overdue anchor is wrong.
