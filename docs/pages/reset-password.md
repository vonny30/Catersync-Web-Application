# Reset Password

`/reset-password` — **src/pages/ResetPassword.jsx** (190 lines)

## What it is for
Sets the new password once identity is proven.

## Rules that matter
- Three ways in: a token in the URL hash, a token in the query, or an **existing recovery session** created by `verifyOtp`. The third is the live path for a code-based email; without it, code resets had no ending.
- Signs out via AuthContext's `logout(false, { silent: true })`, not a raw `signOut()`. The raw call skipped the silent flag, the session-claim release and the lock teardown.

## Data it reads

_Reads no tables directly._

## Data it writes

_Writes nothing._

## Shared modules it depends on

- **utils:** `passwordPolicy`
- **hooks:** _none_
- **realtime:** none

## Review status

Audited 30 Aug 2026.

## Known gaps

- The full flow with a genuine code has not been run end-to-end.
