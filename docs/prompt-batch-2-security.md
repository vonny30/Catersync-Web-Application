# Batch 2 — Four security and data-loss fixes

Four independent changes. They are grouped because they are one review, not
because they interact. Do them in the order given and verify each before moving
on.

Files you may touch:
`src/contexts/AuthContext.jsx`, `src/utils/createWalkInCustomer.jsx`,
`src/pages/PackagesAndMenus/index.jsx`, `src/pages/ResetPassword.jsx`.
Nothing else.

---

## B1 · Authentication currently fails OPEN

**`src/contexts/AuthContext.jsx:292-308`**

After two retries, the `catch` in `checkManagerImpl` ends:

```js
toast.error('Connection issue. Please refresh the page to continue.');
setUser(authUser);
setIsManager(true);
retryCount.current = 0;
return true;
```

Any failure of the `manager` lookup that is not `'Session expired'` — an RLS
denial, a 500, a DNS blip, an offline moment — **grants full manager access**.
The `!manager` deny path at `:213` is only reached when the query *succeeds*, so
it never runs here.

Two consequences:

1. A **customer** account (the mobile app shares this Supabase project) that
   signs in on the admin URL during a transient error is admitted to the manager
   console.
2. This path returns before the session-lock code, so the single-device lock is
   bypassed entirely — a second device can enter while the lock is held.

`ProtectedRoute` reads only `isManager`, so it lets all of this through.

**The intent is understandable** — don't lock a manager out over a network blip.
The failure *direction* is what's wrong. An unresolvable error means "we do not
know whether this person is a manager", and the safe answer to that is no.

**Change:** in that final branch, do not grant. Set `setIsManager(false)`, leave
`setUser(null)`, and surface a distinct, non-alarming state — a message along the
lines of *"Can't verify your account right now. Check your connection and try
again."* with a retry affordance, so the manager understands this is a
connectivity problem rather than a rejected login.

Keep the two retries and the 1.5s backoff exactly as they are — they are the
right mitigation for the transient case. Keep the `'Session expired'` branch
unchanged.

**Acceptance:** with devtools set to offline, signing in must not reach the
dashboard; it must show the connectivity message. Restore the connection, retry,
and the normal flow works. Confirm the session lock still engages on that
successful path.

---

## B2 · Every walk-in customer gets the same hardcoded password

**`src/utils/createWalkInCustomer.jsx:97`, `:155`**

```js
const defaultPassword = 'Password123!';
```

Used for every walk-in `signUp`, and printed in the success toast. The comment
defends it on counter-usability grounds and that concern is legitimate — but the
result is a single shared credential across every walk-in customer account,
guessable from one counter interaction, with no forced reset.

**Change:** generate a random password per customer instead of a constant.

- Build it with `crypto.getRandomValues`, not `Math.random`.
- Make it satisfy the existing policy in `utils/passwordPolicy.js` — read that
  file and generate against its actual rules rather than assuming them.
- Keep the counter workflow intact: the toast still shows the generated password
  **once**, so staff can read it to the customer on the spot. That preserves the
  reason the constant existed while removing the shared secret.
- Never log it to the console and never store it anywhere in the app.

If the customer table or auth flow has a way to force a password change on first
login, set it. If it does not, leave a `TODO` naming that as the follow-up rather
than inventing a schema change — this repo is under a no-schema-changes
constraint.

**Acceptance:** create two walk-in customers in a row and confirm the two toasts
show different passwords, each satisfying the policy. Confirm the customer can
sign in to the mobile app with the password shown.

---

## B3 · Package and menu-item deletes wipe child rows, then report success unchecked

**`src/pages/PackagesAndMenus/index.jsx:783-786` and `:831`**

```js
await supabase.from('package_category').delete().eq('package_id', id);
await supabase.from('package_equipment').delete().eq('package_id', id);
await supabase.from('package_menu').delete().eq('package_id', id);
await supabase.from('package').delete().eq('package_id', id);
toast.success('Package deleted.');
```

Not one of the four results is inspected — in a file that uses
`if (error) throw error` on every other call, including the guards immediately
above these lines.

If the final `package` delete fails — an FK from a table the booking-count guard
doesn't cover, or an RLS policy — the package **survives with its categories,
equipment and menu links already destroyed**, and the manager is told it was
deleted. `fetchData()` then redraws it as an empty, unbookable package.

**Change:** destructure and check `{ error }` on all four deletes (and the
`menu_item` delete at `:831`), throwing on the first failure so the existing
`catch`/`handleError` reports it. Order matters: the child deletes must stay
before the parent, and a failure on any child must stop the sequence rather than
continue into the parent.

Then improve the message. A failure partway through this sequence leaves the
package in a damaged state, and "Failed to delete package." does not tell the
manager that. Say which step failed and that the package may now be incomplete
and should be checked.

**Do not** change the guards above these lines — the booking-count check, the
"last available item in a category included in N packages" check, and
`checkMenuItemUsedInBookings` are all correct and are among the better code in
the file.

**Acceptance:** temporarily point the final delete at a non-existent table to
force a failure, confirm the error surfaces and no success toast appears, then
revert. Confirm a normal delete still works end to end.

---

## B4 · The reset-password page can change a password without knowing the current one

**`src/pages/ResetPassword.jsx:22-30` and `:49-58`**

Two separate weaknesses:

1. The URL gate is `!!new URLSearchParams(window.location.search).get('token')`.
   **Any** value passes, and the token is never verified or used for anything.
2. Path 3 accepts **any existing session** as proof of recovery:
   `const { data } = await supabase.auth.getSession(); if (data?.session) setIsValidToken(true);`

So a signed-in manager — or anyone at an unlocked workstation — can navigate to
`/reset-password`, type a new password, and `updateUser` changes it against the
live session with no current-password check. `SettingsPage.jsx:227` correctly
calls `verifyPassword` first; this page does not. The account owner is then
locked out.

**Path 3 must stay.** The comment explains why: your email template sends a
6-digit code, `ForgotPassword` calls `verifyOtp`, and without this path every
code-based reset bounced back to `/forgot-password` with no ending. Removing it
breaks the only working reset flow.

**Change:** distinguish a *recovery* session from an ordinary one.

- Drop the meaningless `search.get('token')` check entirely. Keep the hash check
  (`access_token` + `type === 'recovery'`), which is real.
- For the session path, verify the session actually came from a recovery flow
  rather than accepting any session. Supabase signals this — check the
  `PASSWORD_RECOVERY` auth event and/or the session's AAL/AMR claims against your
  client version, and gate on that. Read the `supabase-js` version in
  `package.json` before choosing, and if no reliable signal is available in that
  version, have `ForgotPassword.jsx` set a short-lived one-time marker on
  successful `verifyOtp` that this page consumes and clears — but do not treat a
  plain signed-in session as recovery.
- When someone reaches this page with an ordinary session and no recovery signal,
  don't dead-end them: send them to Settings → Change Password, which already
  does this correctly with a current-password check.

**Acceptance:** sign in normally, navigate directly to `/reset-password` — you
must not be able to set a new password; you should be redirected to the Settings
change-password flow. Then run a genuine forgot-password reset with the emailed
code end to end and confirm it still completes.

---

## Across all four

- Do not touch any other file.
- Do not weaken or remove any existing check while adding these.
- After each fix, state which one you did and what you verified, so they can be
  reviewed one at a time rather than as a single large diff.
