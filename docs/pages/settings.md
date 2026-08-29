# Settings

`/app/settings` — **src/pages/SettingsPage.jsx** (546 lines)

## What it is for
Business profile and the manager's own security: change email, change password.

## Rules that matter
- Changing the password re-verifies the current one through `utils/verifyPassword`, which signs in on an **isolated throwaway client** so the app's real session is untouched. That client must sign out with `scope: 'local'` — the default is global and revokes every token for the user, which previously destroyed the session mid-change.
- Both security changes sign the manager out afterwards, deliberately.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `manager` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `manager (update)` | 2 |

## Shared modules it depends on

- **utils:** `passwordPolicy`, `verifyPassword`
- **hooks:** _none_
- **realtime:** none

## Review status

Audited 30 Aug 2026 after a reported error; the global-signOut bug was found here.

## Known gaps

- The 50%-downpayment and balance rules live here and in `usePaymentHandlers` and Payments — three copies of similar validation.
