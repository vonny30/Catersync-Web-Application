// src/utils/formErrors.js
//
// Shared helper so every form in the app highlights an invalid field the
// same way — red border/ring/tint on the input, red inline text below it —
// instead of leaving the manager to re-read a toast to figure out which
// field to fix. Used alongside a per-form `fieldErrors` state object keyed
// by field name.
export function errorInputClass(hasError, base = '') {
  const shared = base ? `${base} ` : '';
  return hasError
    ? `${shared}border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40`
    : `${shared}border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]`;
}
