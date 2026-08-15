// src/pages/PackagesAndMenus/CategoryManagerModal.jsx
import { createPortal } from 'react-dom';

export default function CategoryManagerModal({
  isOpen,
  categories,
  categoryForm,
  isCategorySubmitting,
  onClose,
  onEdit,
  onDelete,
  onFormChange,
  onSubmit,
  onCancelEdit,
}) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <h2 className="text-lg font-bold text-slate-900">Manage Categories</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-2">
            {categories.length === 0 && (
              <p className="text-sm text-slate-500 italic">No categories yet — add one below.</p>
            )}
            {categories.map(cat => (
              <div key={cat.category_id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50">
                <div>
                  <p className="font-bold text-slate-900">{cat.category_name}</p>
                  {cat.category_description && <p className="text-xs text-slate-500">{cat.category_description}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onEdit(cat)} className="text-slate-500 hover:text-slate-700 text-sm">Edit</button>
                  <button onClick={() => onDelete(cat.category_id)} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50">
          <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-700 mb-1">Category Name</label>
              <input type="text" name="category_name" value={categoryForm.category_name} onChange={onFormChange}
                placeholder="e.g. Seafood" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45] outline-none" required />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-700 mb-1">Description (optional)</label>
              <input type="text" name="category_description" value={categoryForm.category_description} onChange={onFormChange}
                placeholder="e.g. All seafood dishes" className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45] outline-none" />
            </div>
            <button type="submit" disabled={isCategorySubmitting}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
              {isCategorySubmitting ? 'Saving...' : (categoryForm.category_id ? 'Update' : 'Add')}
            </button>
            {categoryForm.category_id && (
              <button type="button" onClick={onCancelEdit}
                className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            )}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
