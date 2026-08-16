// src/pages/PackagesAndMenus/PackageCard.jsx
import ImageWithFallback from './ImageWithFallback';

export default function PackageCard({ pkg, categoryNames, equipmentNames, onEdit, onArchive, onDelete }) {
  return (
    <div className="flex flex-col md:flex-row bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-[#008A45]/30 transition-all">
      <div className="w-full md:w-72 h-48 md:h-auto bg-slate-200 shrink-0 relative">
        <ImageWithFallback src={pkg.pkg_image} alt={pkg.pkg_name} className="w-full h-full object-cover" />
      </div>
      <div className="p-6 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap justify-between items-start gap-4 mb-2">
            <div>
              <h3 className="text-xl font-bold text-slate-900">{pkg.pkg_name}</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
                pkg.pricing_type === 'fixed'
                  ? 'bg-purple-50 border border-purple-200 text-purple-700'
                  : 'bg-blue-50 border border-blue-200 text-blue-700'
              }`}>
                {pkg.pricing_type === 'fixed' ? '📦 Fixed Price' : '👤 Per Pax'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onEdit(pkg)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-50 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => onArchive(pkg.package_id)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-50 transition-colors"
              >
                {pkg.pkg_availability === 'Archived' ? 'Unarchive' : 'Archive'}
              </button>
              <button
                onClick={() => onDelete(pkg.package_id)}
                className="px-3 py-1 bg-red-50 border border-red-200 text-red-600 text-xs font-semibold rounded-md hover:bg-red-100 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3 max-w-2xl">{pkg.pkg_description}</p>

          {categoryNames.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Included Categories:</p>
              <div className="flex flex-wrap gap-1.5">
                {categoryNames.map((name, index) => (
                  <span key={index} className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {equipmentNames.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Included Equipment:</p>
              <div className="flex flex-wrap gap-1.5">
                {equipmentNames.map((item, index) => (
                  <span key={index} className="px-2.5 py-0.5 bg-[#EAF3F2] text-slate-700 text-xs rounded-full border border-[#CBDEDD]">
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-8 flex-wrap">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">
                {pkg.pricing_type === 'fixed' ? 'Fixed Price' : 'Price per Pax'}
              </p>
              <p className="font-bold text-slate-900">
                ₱{Number(pkg.pkg_price).toLocaleString()}
                {pkg.pricing_type === 'per_pax' && <span className="text-sm font-normal text-slate-500">/pax</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Min pax.</p>
              <p className="font-bold text-slate-900">{pkg.minimum_pax}</p>
            </div>
            {pkg.pricing_type === 'fixed' && pkg.max_pax && (
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Max pax included</p>
                <p className="font-bold text-slate-900">{pkg.max_pax}</p>
                {pkg.extra_pax_price > 0 && (
                  <p className="text-xs text-slate-500">Extra: ₱{pkg.extra_pax_price}/pax</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
