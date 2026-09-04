// src/pages/PackagesAndMenus/PackageCard.jsx
import { Trash2 } from 'lucide-react';
import ImageWithFallback from './ImageWithFallback';

// Shared action-button classes. Deliberately heavier than the rest of the
// card's chrome: these are the only things on it you can act on, and as 12px
// text links they read as captions rather than controls.
const ACTION_BTN = 'px-[13px] py-[7px] text-[13px] font-semibold rounded-[9px] border border-slate-300 '
  + 'bg-white text-slate-700 transition-colors hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038] '
  + 'focus:outline-none focus:ring-2 focus:ring-[#008A45]/40';

const STAT_LABEL = 'block text-[12.5px] text-slate-600 mb-1';
const STAT_VALUE = 'block text-xl font-semibold tracking-[-0.02em] tabular-nums text-slate-900';

export default function PackageCard({ pkg, categoryNames, equipmentNames, onEdit, onArchive, onDelete }) {
  const isArchived = pkg.pkg_availability === 'Archived';
  // Extra-pax pricing only means anything on a fixed package that caps its

  return (
    <div className="flex flex-col md:flex-row bg-white border border-slate-200/70 rounded-2xl overflow-hidden transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_14px_rgba(15,23,42,0.05)]">
      <div className="w-full md:w-[236px] h-48 md:h-auto bg-slate-100 shrink-0 relative">
        <ImageWithFallback src={pkg.pkg_image} alt={pkg.pkg_name} className="w-full h-full object-cover" />
      </div>

      <div className="px-[22px] py-5 flex-1 flex flex-col gap-3.5">
        {/* title + actions */}
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div className="min-w-0">
            <h3 className="text-[19px] font-bold tracking-[-0.015em] text-slate-900">{pkg.pkg_name}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={`inline-flex px-2.5 py-[3px] rounded-full text-[12.5px] font-semibold whitespace-nowrap ${
                pkg.pricing_type === 'fixed' ? 'bg-[#f6edfe] text-purple-700' : 'bg-blue-50 text-blue-700'
              }`}>
                {pkg.pricing_type === 'fixed' ? 'Fixed price' : 'Per pax'}
              </span>
              {/* Without this an archived package is indistinguishable from a
                  live one on the Archived tab. */}
              {isArchived && (
                <span className="inline-flex px-2.5 py-[3px] rounded-full bg-slate-100 text-slate-600 text-[12.5px] font-semibold whitespace-nowrap">
                  Archived
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button onClick={() => onEdit(pkg)} className={ACTION_BTN}>Edit</button>
            <button onClick={() => onArchive(pkg.package_id)} className={`${ACTION_BTN} whitespace-nowrap`}>
              {isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={() => onDelete(pkg.package_id)}
              title="Delete"
              className="flex items-center justify-center w-8 h-8 rounded-[9px] border border-slate-300 bg-white text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 hover:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {pkg.pkg_description && (
          <p className="text-sm text-slate-600 max-w-[620px] [text-wrap:pretty]">{pkg.pkg_description}</p>
        )}

        {/* Pricing was last and smallest on the card while being the thing
            people scan for. Its own band, above the chips. */}
        <div className="flex flex-wrap gap-[22px] py-3.5 border-y border-slate-100">
          <div>
            <span className={STAT_LABEL}>{pkg.pricing_type === 'fixed' ? 'Fixed price' : 'Price per pax'}</span>
            <span className={STAT_VALUE}>
              ₱{Number(pkg.pkg_price).toLocaleString()}
              {pkg.pricing_type === 'per_pax' && <span className="text-sm font-medium text-slate-600">/pax</span>}
            </span>
          </div>
          <div>
            <span className={STAT_LABEL}>Min pax</span>
            <span className={STAT_VALUE}>{pkg.minimum_pax}</span>
          </div>
          {pkg.pricing_type === 'fixed' && pkg.max_pax && (
            <div>
              <span className={STAT_LABEL}>Max pax</span>
              <span className={STAT_VALUE}>{pkg.max_pax}</span>
            </div>
          )}
        </div>

        {/* Two short lists side by side rather than stacked -- stacking wasted
            the width of a full-bleed card. */}
        {(categoryNames.length > 0 || equipmentNames.length > 0) && (
          <div className="flex flex-wrap gap-5">
            {categoryNames.length > 0 && (
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-slate-600 mb-[7px]">Included categories</p>
                <div className="flex flex-wrap gap-1.5">
                  {categoryNames.map((name, index) => (
                    <span key={index} className="inline-flex px-[11px] py-1 rounded-full bg-slate-100 text-slate-700 text-[12.5px] font-medium whitespace-nowrap">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {equipmentNames.length > 0 && (
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-slate-600 mb-[7px]">Included equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {equipmentNames.map((item, index) => (
                    <span key={index} className="inline-flex px-[11px] py-1 rounded-full bg-[#EAF3F2] text-[#00703a] text-[12.5px] font-medium whitespace-nowrap">
                      {item.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
