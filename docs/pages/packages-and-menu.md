# Packages & Menu

`/app/packages` — **src/pages/PackagesAndMenus/index.jsx** (1415 lines)

## What it is for
The catalogue: catering packages, short-order menu items, and the categories
that connect them. Packages include whole categories rather than individual
items, so any available item in an included category becomes selectable.

## Rules that matter
- Archive and delete are different guarantees. Delete **refuses** when the item is referenced; archive **warns** and proceeds, because it is reversible.
- Archiving the last available item in a category that packages include reaches the same broken state deletion refuses — a package offering a category with nothing in it. That is warned about with the package count.
- The archive dialog is direction-aware: restoring is not a warning and must not be styled as one. `ConfirmModal` falls back to **danger** for any variant it does not recognise, so only `danger` / `warning` / `success` are valid.
- `checkMenuItemUsedInBookings` pages through the booking table. Unbounded, it answered '0 bookings use this item' past 1000 rows and let a referenced item be deleted.

## Data it reads

| Table | Queries | Whole-table with no row bound |
|---|---|---|
| `booking` | 2 | no |
| `category` | 2 | **yes — 1** |
| `equipment` | 1 | no |
| `menu_item` | 3 | **yes — 1** |
| `package` | 2 | **yes — 1** |
| `package_category` | 6 | no |
| `package_equipment` | 3 | no |
| `package_menu` | 1 | no |

## Data it writes

| Operation | Sites |
|---|---|
| `category (delete)` | 1 |
| `category (insert)` | 1 |
| `category (update)` | 1 |
| `menu_item (delete)` | 1 |
| `menu_item (insert)` | 1 |
| `menu_item (update)` | 2 |
| `package (delete)` | 1 |
| `package (insert)` | 1 |
| `package (update)` | 2 |
| `package_category (delete)` | 2 |
| `package_category (insert)` | 1 |
| `package_equipment (delete)` | 2 |
| `package_equipment (insert)` | 1 |
| `package_menu (delete)` | 1 |

## Shared modules it depends on

- **utils:** `fetchAllRows`
- **hooks:** _none_
- **realtime:** none

## Review status

Audited 30 Aug 2026 — the unarchive wording plus three robustness gaps.

## Known gaps

- ~~Three unbounded whole-table reads in the form/dropdown fetches (`package`, `menu_item`, `category`).~~ **Already fixed** — verified 30 Aug 2026; all three page through `fetchAllRows` with total orderings. This gap line was stale.
- `package_menu` is written by nothing in this app; the delete guard checks it defensively in case another client populates it.
