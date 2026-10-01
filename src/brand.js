// src/brand.js
//
// The one place the logo is set. Every logo in the app reads from here: the
// browser tab icon (index.html, through vite.config.js), the top bar and the
// mobile menu, the Login / Forgot Password / Reset Password pages, and the
// downloadable Booking Details sheet.
//
// To use the real logo at handover:
//   1. Put the file in frontend/public/ (PNG, JPG, SVG or WebP; square or
//      wide both work — logos are fitted inside their frame, never cropped).
//   2. Point LOGO_SRC at it, e.g. '/pgs-logo.png'.
//   3. Rebuild (npm run build) and deploy.
// Plain JS on purpose: vite.config.js imports this file too.

export const LOGO_SRC = '/logo.svg';

// Read aloud by screen readers in place of the image.
export const LOGO_ALT = 'CaterSync logo';
