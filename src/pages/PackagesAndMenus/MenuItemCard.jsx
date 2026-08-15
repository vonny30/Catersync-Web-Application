// src/pages/PackagesAndMenus/MenuItemCard.jsx
import ImageWithFallback from './ImageWithFallback';

export default function MenuItemCard({ item, categoryName, onEdit, onArchive, onDelete }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
      <div>
        <div className="w-full h-32 bg-slate-100 rounded-lg mb-3 flex items-center justify-center text-slate-300 overflow-hidden">
          <ImageWithFallback src={item.menu_image} alt={item.menu_name} className="w-full h-full object-cover" />
        </div>
        <p className="text-xs font-bold text-[#008A45] mb-1">{categoryName || 'Uncategorized'}</p>
        <h4 className="font-bold text-slate-900">{item.menu_name}</h4>
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.menu_description || 'No description'}</p>
        <p className="font-semibold text-slate-700 mt-2">
          ₱{Number(item.menu_price).toLocaleString()} <span className="text-sm font-normal text-slate-500">/ tray</span>
        </p>
        <p className="text-xs text-slate-400 mt-1">Each tray serves 35‑50 pax</p>
      </div>
      <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
        <button
          onClick={() => onEdit(item)}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          Edit
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => onArchive(item.menu_item_id)}
            className="text-xs font-semibold text-slate-500 hover:text-[#008A45] transition-colors"
          >
            {item.menu_availability === 'Archived' ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={() => onDelete(item.menu_item_id)}
            className="text-xs font-semibold text-red-400 hover:text-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
