# Login

`/login` — **src/pages/Login.jsx** (332 lines)

## What it is for
Manager sign-in. Two-panel layout: brand panel on the left, form on the right,
form-only below 1024px.

## Rules that matter
- The redirect to `/app` requires a **live session**, not just `isManager`. On sign-out that flag stays true for 500ms, and the password-reset flow lands in exactly that window — it used to flash into the dashboard and bounce back.
- Non-manager rejection signs out with `scope: 'local'`. The customer mobile app shares this Supabase project; a global sign-out would log a customer out of it for using the wrong page.
- Inputs are 16px because iOS Safari zooms the page on focus below that.
- Panel content is capped and centred within each half, so gutters grow together when zoomed out.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `manager` | 1 | no |

## Data it writes

_Writes nothing._

## Shared modules it depends on

- **utils:** _none_
- **hooks:** _none_
- **realtime:** none

## Review status

Rebuilt and verified in a real browser at 360-3840px.

## Known gaps

_None recorded._
