// src/utils/packageRules.js
//
// What headcount a package will actually accept.
//
// A fixed-price package covers a BAND: minimum_pax..max_pax, one flat price
// inside it, and a booking outside it is refused — the same treatment the
// minimum has always had. Per-pax packages have a floor only; their price
// scales with the guest count, so there is nothing to cap.
//
// This lives in one file because the rule it replaces did not. `minimum_pax`
// was checked when a booking was CREATED and nowhere else, so a 20-guest
// booking could be edited down to 5 and saved, and approval — which writes
// pax_count + extraPax and then reallocates equipment against the new figure —
// had no check at all. Three write paths, one guard. Adding a second copy here
// would repeat what put three drifting versions of the completion filter in
// this codebase.
//
// See docs/fixed-package-cap.md; §5 of it is the same rule written for the
// customer mobile app, which books packages too.

/**
 * Is this headcount allowed for this package?
 *
 * `max_pax = null` means **no cap recorded**, not a cap of zero, and is
 * deliberately permissive. Packages predating this rule must keep working and
 * their existing bookings must stay editable — Granite has live bookings at 50
 * and 55 with no cap set. The package form now requires a cap on fixed
 * packages, so null drains out as packages are edited rather than needing a
 * migration that would guess a number nobody has decided.
 *
 * @param {object|null} pkg  the package row (pkg_name, pricing_type,
 *                           minimum_pax, max_pax)
 * @param {number|string} paxCount
 * @returns {{ok: true} | {ok: false, message: string}} — `message` is shown
 *          to the manager as written, in both the toast and the field error.
 */
export function validatePaxForPackage(pkg, paxCount) {
  // No package selected yet: there is nothing to validate against, and the
  // caller has its own "choose a package" check.
  if (!pkg) return { ok: true };

  const pax = parseInt(paxCount, 10);

  if (!Number.isFinite(pax) || pax < 1) {
    return { ok: false, message: 'Must be at least 1.' };
  }

  // Wording preserved verbatim — it is already on screen and in the field
  // error, and changing it here would silently change what a manager reads.
  if (pkg.minimum_pax && pax < pkg.minimum_pax) {
    return { ok: false, message: `Minimum pax for this package is ${pkg.minimum_pax}.` };
  }

  // The new half. Only a recorded cap can be exceeded.
  if (pkg.max_pax && pax > pkg.max_pax) {
    return {
      ok: false,
      message: `${pkg.pkg_name || 'This package'} covers up to ${pkg.max_pax} guests. Choose a per-pax package for a larger event.`,
    };
  }

  return { ok: true };
}

/**
 * Does this package need a cap before it can be saved?
 *
 * Fixed packages must declare one from now on, which is how `max_pax = null`
 * stops being a permanent exception. Per-pax packages must not — their price
 * scales, so a cap would be an arbitrary refusal.
 */
export const requiresMaxPax = (pricingType) => pricingType === 'fixed';
