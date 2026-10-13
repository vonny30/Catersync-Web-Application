// src/components/Brand.jsx
//
// The brand as the app's chrome shows it: the logo in a circle and the name
// "PG's Catering · CaterSync" — the business first, then the product. Used by
// the top bar, the mobile menu and the Login / Forgot Password / Reset
// Password pages, so they all change together.
//
// The business name is read from Settings -> Business Details
// (utils/businessProfile), so renaming the business there renames it here,
// in the browser tab, and on the booking sheet. "CaterSync" is the product
// and lives in brand.js with the logo.
import { useEffect } from 'react';
import { LOGO_SRC, LOGO_ALT, APP_NAME } from '../brand';
import { useBusinessProfile } from '../utils/businessProfile';

/**
 * The logo in a white circle. The logo is a wide oval, so it is fitted to the
 * circle and then enlarged 112%: the oval nearly fills the circle without its
 * edge being cut (measured: its farthest point sits at 0.486 of the circle's
 * diameter; 0.5 is the edge), and only the white corners of the picture fall
 * outside. A different logo may need a different enlargement.
 * @param className  size and ring/border, e.g. "w-11 h-11 ring-2 ring-white/40"
 */
export function BrandLogo({ className = '' }) {
  return (
    <div className={`rounded-full overflow-hidden bg-white shrink-0 ${className}`}>
      <img src={LOGO_SRC} alt={LOGO_ALT} className="w-full h-full object-contain scale-[1.12]" />
    </div>
  );
}

/** "PG's Catering · CaterSync" as plain text, for inside a heading or span. */
export function BrandName() {
  const { business_name: business } = useBusinessProfile();
  return `${business} · ${APP_NAME}`;
}

/** Keeps the browser tab's title in step with the business name. Renders nothing. */
export function BrandTitle() {
  const { business_name: business } = useBusinessProfile();
  useEffect(() => {
    document.title = `${business} · ${APP_NAME}`;
  }, [business]);
  return null;
}
