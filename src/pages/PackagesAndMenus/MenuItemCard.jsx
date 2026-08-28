// src/pages/PackagesAndMenus/MenuItemCard.jsx
import { Trash2 } from 'lucide-react';
import ImageWithFallback from './ImageWithFallback';

// Matches PackageCard's action buttons. These were three 12px text links with
// no hit area; on a card this small they are the whole point of the card.
const ACTION_BTN = 'flex-1 py-[7px] rounded-[9px] border border-slate-300 bg-white text-slate-700 '
  + 'text-[13px] font-semibold transition-colors hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038] '
  + 'focus:outline-none focus:ring-2 focus:ring-[#008A45]/40';

export default function MenuItemCard({ item, categoryName, onEdit, onArchive, onDelete }) {
  const isArchived = item.menu_availability === 'Archived';

  return (
    <div className="bg-white border border-slate-200/70 rounded-[15px] overflow-hidden transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] flex flex-col">
      <div className="h-[130px] bg-slate-100 relative flex items-center justify-center text-slate-300 overflow-hidden">
        <ImageWithFallback src={item.menu_image} alt={item.menu_name} className="w-full h-full object-cover" />
        {/* On the image rather than above the title: it frees a line and the
            category reads as a tag on the item, which is what it is. */}
        <span className="absolute top-2.5 left-2.5 inline-flex px-2.5 py-[3px] rounded-full bg-white/95 text-[#00703a] text-[11.5px] font-bold tracking-[0.02em] whitespace-nowrap">
          {categoryName || 'Uncategorized'}
        </span>
        {isArchived && (
          <span className="absolute top-2.5 right-2.5 inline-flex px-2.5 py-[3px] rounded-full bg-white/95 text-slate-600 text-[11.5px] font-bold tracking-[0.02em] whitespace-nowrap">
            Archived
          </span>
        )}
      </div>

      <div className="flex-1 px-4 py-3.5 flex flex-col">
        <h4 className="text-[15.5px] font-semibold text-slate-900">{item.menu_name}</h4>
        <p className="text-[13px] text-slate-600 mt-1.5 leading-[1.45]">{item.menu_description || 'No description'}</p>
        {/* The "each tray serves 35-50 pax" line that used to sit here was
            identical on every card; it is stated once in the section subhead. */}
        <p className="mt-auto pt-3.5 text-[19px] font-semibold tracking-[-0.02em] tabular-nums text-slate-900">
          ₱{Number(item.menu_price).toLocaleString()}
          <span className="text-[13.5px] font-medium text-slate-600"> / tray</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5 px-3.5 py-[11px] border-t border-slate-100">
        <button onClick={() => onEdit(item)} className={ACTION_BTN}>Edit</button>
        <button onClick={() => onArchive(item.menu_item_id)} className={`${ACTION_BTN} whitespace-nowrap`}>
          {isArchived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          onClick={() => onDelete(item.menu_item_id)}
          title="Delete"
          className="flex items-center justify-center w-8 h-8 shrink-0 rounded-[9px] border border-slate-300 bg-white text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 hover:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
