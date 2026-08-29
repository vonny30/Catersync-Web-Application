# Forgot Password

`/forgot-password` — **src/pages/ForgotPassword.jsx** (301 lines)

## What it is for
Requests a password reset and accepts the code that arrives by email.

## Rules that matter
- Supabase's template for this project sends an **8-digit code**, not a link. The page takes the code and calls `verifyOtp` to exchange it for a recovery session.
- Supabase returns one message — 'Token has expired or is invalid' — for both a mistyped and a stale code, so the copy covers both rather than claiming expiry it cannot know.
- Resend has a 60-second cooldown matching Supabase's own throttle.

## Data it reads

_Reads no tables directly._

## Data it writes

_Writes nothing._

## Shared modules it depends on

- **utils:** _none_
- **hooks:** _none_
- **realtime:** none

## Review status

Built and exercised against real Supabase (send leg and a rejected code).

## Known gaps

- Entering a genuine code end-to-end needs a real inbox; not yet done.
