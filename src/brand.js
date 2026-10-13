// src/brand.js
//
// The one place the logo is set. Every logo in the app reads from here: the
// browser tab icon (index.html, through vite.config.js), the top bar and the
// mobile menu, the Login / Forgot Password / Reset Password pages, and the
// downloadable Booking Details sheet.
//
// The logo is PGS Foods & Catering's own (public/pgs-logo.jpg, 2000 x 1333,
// set 14 Oct 2026). It is wide, so its frames are white 3:2 badges rather
// than circles; it is fitted inside them, never cropped.
//
// To change it later:
//   1. Put the file in frontend/public/ (PNG, JPG, SVG or WebP).
//   2. Point LOGO_SRC at it, e.g. '/new-logo.png'.
//   3. Rebuild (npm run build) and deploy.
// The Booking Details sheet draws the logo 74px high at its own proportions
// (html2canvas ignores object-fit, so a fixed square box would stretch it).
// An SVG needs a fixed width and height on its <svg> tag (not 100%), or it
// comes out blank on the downloaded sheet.
// Plain JS on purpose: vite.config.js imports this file too.

export const LOGO_SRC = '/pgs-logo.jpg';

// Read aloud by screen readers in place of the image.
export const LOGO_ALT = 'PGS Foods & Catering logo';
