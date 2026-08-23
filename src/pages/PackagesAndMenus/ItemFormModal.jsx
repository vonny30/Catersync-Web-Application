// src/pages/PackagesAndMenus/ItemFormModal.jsx
import { useEffect, useState } from 'react';
import Select from '../../components/Select';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { DEFAULT_COLORS, getSwatchColor } from './constants';

function FormSection({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100 pb-1.5">{title}</h3>
      {children}
    </div>
  );
}

export default function ItemFormModal({
  isOpen,
  modalType,
  editingId,
  formData,
  categories,
  equipment,
  isSubmitting,
  newColorInput,
  onClose,
  onSubmit,
  onInputChange,
  onTypeChange,
  onCategorySelection,
  onEquipmentSelection,
  onEquipmentQuantityChange,
  onColorInputChange,
  onAddColor,
  onRemoveColor,
  onQuickAddColor,
  onPricingTypeChange,
  onCheckDuplicateTitle,
}) {
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(false);
  const [isEquipmentExpanded, setIsEquipmentExpanded] = useState(false);

  // Live "this name is taken" feedback, debounced so it doesn't hammer the
  // database on every keystroke — the same check also runs again on submit
  // as the source of truth.
  useEffect(() => {
    if (!isOpen || !formData.title || !formData.title.trim()) {
      setDuplicateWarning(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const isDuplicate = await onCheckDuplicateTitle(formData.title);
      if (!cancelled) setDuplicateWarning(isDuplicate);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formData.title, isOpen, onCheckDuplicateTitle]);

  // Thumbnail preview: the newly-picked file if there is one, otherwise
  // whatever image is already saved (when editing).
  useEffect(() => {
    if (formData.imageFile) {
      const url = URL.createObjectURL(formData.imageFile);
      setImagePreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setImagePreviewUrl(formData.existingImageUrl || null);
  }, [formData.imageFile, formData.existingImageUrl]);

  useEffect(() => {
    if (!isOpen) {
      setIsCategoriesExpanded(false);
      setIsEquipmentExpanded(false);
      setDuplicateWarning(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedCategoryCount = (formData.selectedCategories || []).length;
  const selectedEquipmentCount = (formData.selectedEquipment || []).length;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Item' : 'Add New Item'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" disabled={isSubmitting}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <form id="item-form" onSubmit={onSubmit} className="space-y-6">
            {/* Type Toggle */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">Type</label>
              <div className="flex gap-4">
                <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg transition-colors
                  ${modalType === 'Package' ? 'bg-[#EAF3F2] border-[#008A45] text-slate-900' : 'border-slate-200 text-slate-600'}
                  ${editingId || isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}>
                  <input type="radio" name="itemType" value="Package" checked={modalType === 'Package'}
                    disabled={!!editingId || isSubmitting}
                    onChange={() => onTypeChange('Package')}
                    className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                  <span className="font-medium text-sm">Package</span>
                </label>
                <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg transition-colors
                  ${modalType === 'Menu Item' ? 'bg-[#EAF3F2] border-[#008A45] text-slate-900' : 'border-slate-200 text-slate-600'}
                  ${editingId || isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}>
                  <input type="radio" name="itemType" value="Menu Item" checked={modalType === 'Menu Item'}
                    disabled={!!editingId || isSubmitting}
                    onChange={() => onTypeChange('Menu Item')}
                    className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                  <span className="font-medium text-sm">Menu Item</span>
                </label>
              </div>
            </div>

            {/* Package Fields */}
            {modalType === 'Package' && (
              <div className="space-y-6">
                <FormSection title="Basic Info">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-4 sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">Package Title *</label>
                      <input type="text" name="title" value={formData.title} onChange={onInputChange}
                        placeholder="e.g. Buffet Tier 1"
                        className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${
                          duplicateWarning ? 'border-amber-400 focus:ring-amber-200 focus:border-amber-400' : 'border-slate-300 focus:ring-[#008A45] focus:border-[#008A45]'
                        }`}
                        required disabled={isSubmitting} />
                      {duplicateWarning && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <AlertTriangle size={12} /> A package named "{formData.title}" already exists.
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 mb-1">Min Pax. *</label>
                      <input type="number" name="minPax" value={formData.minPax} onChange={onInputChange}
                        placeholder="e.g. 50"
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                        required disabled={isSubmitting} />
                      <p className="text-xs text-slate-400 mt-1">Smallest guest count this package can be booked for.</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Description *</label>
                    <textarea name="description" value={formData.description} onChange={onInputChange}
                      placeholder="Describe the package..." rows="3"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                      required disabled={isSubmitting} />
                  </div>
                </FormSection>

                <FormSection title="Pricing">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Pricing Model</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onPricingTypeChange('per_pax')}
                          className={`p-2 rounded-lg border-2 text-sm font-semibold transition-all ${formData.pricing_type === 'per_pax' ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.pricing_type === 'per_pax' ? 'border-[#008A45]' : 'border-slate-400'}`}>
                              {formData.pricing_type === 'per_pax' && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                            </div>
                            Per Pax
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onPricingTypeChange('fixed')}
                          className={`p-2 rounded-lg border-2 text-sm font-semibold transition-all ${formData.pricing_type === 'fixed' ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                          <div className="flex items-center justify-center gap-2">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.pricing_type === 'fixed' ? 'border-[#008A45]' : 'border-slate-400'}`}>
                              {formData.pricing_type === 'fixed' && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                            </div>
                            Fixed
                          </div>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        {formData.pricing_type === 'per_pax' ? 'Price per Pax (₱) *' : 'Fixed Price (₱) *'}
                      </label>
                      <input type="number" name="price" value={formData.price} onChange={onInputChange}
                        placeholder={formData.pricing_type === 'per_pax' ? 'e.g. 500' : 'e.g. 25000'}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                        required disabled={isSubmitting} />
                    </div>
                  </div>

                  {formData.pricing_type === 'fixed' && (() => {
                    const minPaxNum = parseInt(formData.minPax) || 0;
                    const maxPaxNum = formData.max_pax === '' ? null : parseInt(formData.max_pax);
                    const maxPaxTooLow = maxPaxNum !== null && !isNaN(maxPaxNum) && maxPaxNum < minPaxNum;
                    const extraPriceNum = formData.extra_pax_price === '' ? null : parseFloat(formData.extra_pax_price);
                    const extraPriceNegative = extraPriceNum !== null && !isNaN(extraPriceNum) && extraPriceNum < 0;
                    return (
                      <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">Max Pax Included</label>
                          <input type="number" name="max_pax" min={minPaxNum || 1} value={formData.max_pax} onChange={onInputChange}
                            placeholder="e.g. 100"
                            className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${maxPaxTooLow ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
                            disabled={isSubmitting} />
                          {maxPaxTooLow ? (
                            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                              <AlertTriangle size={12} /> Can't be less than Minimum Pax ({minPaxNum}).
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400 mt-1">Different from Min Pax above — guests beyond this number pay the extra fee below.</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">Extra Pax Price (₱)</label>
                          <input type="number" name="extra_pax_price" min="0" value={formData.extra_pax_price} onChange={onInputChange}
                            placeholder="e.g. 250"
                            className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${extraPriceNegative ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'}`}
                            disabled={isSubmitting} />
                          {extraPriceNegative ? (
                            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                              <AlertTriangle size={12} /> Can't be negative.
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400 mt-1">Price per guest above max</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </FormSection>

                <FormSection title="Customization">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Available Colors</label>
                    <p className="text-xs text-slate-400 mb-2">Motif colors customers can pick from when booking this package.</p>

                    {DEFAULT_COLORS.some(c => !(formData.colors || []).includes(c)) && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-slate-500 mb-1.5">Quick add</p>
                        <div className="flex flex-wrap gap-1.5">
                          {DEFAULT_COLORS.filter(c => !(formData.colors || []).includes(c)).map(color => (
                            <button
                              type="button"
                              key={color}
                              onClick={() => onQuickAddColor(color)}
                              disabled={isSubmitting}
                              className="inline-flex items-center gap-1.5 border border-slate-200 rounded-full pl-1.5 pr-2.5 py-1 text-xs text-slate-600 hover:border-[#008A45] hover:bg-[#EAF3F2] hover:text-slate-900 transition-colors disabled:opacity-50"
                            >
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                                style={{ backgroundColor: getSwatchColor(color) }}
                              />
                              {color}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs font-semibold text-slate-500 mb-1.5">Custom color</p>
                    <div className="flex gap-2">
                      <input type="text" value={newColorInput} onChange={onColorInputChange}
                        placeholder="e.g. Rose Gold"
                        className="flex-1 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                        disabled={isSubmitting}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddColor(); } }} />
                      <button type="button" onClick={onAddColor} disabled={isSubmitting}
                        className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">Add</button>
                    </div>

                    <p className="text-xs font-semibold text-slate-500 mt-3 mb-1.5">
                      Selected ({(formData.colors || []).length})
                    </p>
                    {(formData.colors || []).length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No colors added yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {formData.colors.map(color => (
                          <span key={color} className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-full pl-1.5 pr-2 py-1 text-sm">
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                              style={{ backgroundColor: getSwatchColor(color) }}
                            />
                            {color}
                            <button type="button" onClick={() => onRemoveColor(color)} className="text-slate-400 hover:text-red-500 transition-colors" disabled={isSubmitting}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </FormSection>

                <FormSection title="Menu & Equipment">
                  <div>
                    <button
                      type="button"
                      onClick={() => setIsCategoriesExpanded(v => !v)}
                      className="w-full flex items-center justify-between border border-slate-200 rounded-lg p-2.5 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-medium text-slate-700">Included Categories</span>
                      <span className="flex items-center gap-2 text-slate-500">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${selectedCategoryCount > 0 ? 'bg-[#EAF3F2] text-[#008A45]' : 'bg-slate-100 text-slate-400'}`}>
                          {selectedCategoryCount} selected
                        </span>
                        {isCategoriesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>
                    {isCategoriesExpanded && (
                      <div className="mt-2 grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                        {categories.map((cat) => (
                          <label key={cat.category_id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox"
                              checked={(formData.selectedCategories || []).includes(cat.category_id)}
                              onChange={() => onCategorySelection(cat.category_id)}
                              disabled={isSubmitting}
                              className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                            {cat.category_name}
                            {cat.category_description && <span className="text-xs text-slate-400">({cat.category_description})</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-1">Customers can choose one menu item from each selected category.</p>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setIsEquipmentExpanded(v => !v)}
                      className="w-full flex items-center justify-between border border-slate-200 rounded-lg p-2.5 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-medium text-slate-700">Included Equipment (template)</span>
                      <span className="flex items-center gap-2 text-slate-500">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${selectedEquipmentCount > 0 ? 'bg-[#EAF3F2] text-[#008A45]' : 'bg-slate-100 text-slate-400'}`}>
                          {selectedEquipmentCount} selected
                        </span>
                        {isEquipmentExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>
                    {isEquipmentExpanded && (
                      <>
                        <p className="text-xs text-slate-400 mt-2 mb-2">Equipment will be reserved when a booking is confirmed, not now.</p>
                        <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                          {equipment.map((eq) => {
                            const isSelected = (formData.selectedEquipment || []).includes(eq.equipment_id);
                            const isCountable = eq.equipment_type === 'Countable';
                            const hasPaxPerUnit = isCountable && Number(eq.pax_per_unit) > 0;
                            const currentQty = formData.equipmentQuantities?.[eq.equipment_id] || 1;
                            const exceedsStock = isSelected && !hasPaxPerUnit && currentQty > eq.quantity_available;
                            return (
                              <div key={eq.equipment_id} className="text-sm">
                                <div className="flex items-center gap-3">
                                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                                    <input type="checkbox"
                                      checked={isSelected}
                                      onChange={() => onEquipmentSelection(eq.equipment_id, 1)}
                                      disabled={isSubmitting}
                                      className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                                    {eq.eqm_name} (total stock: {eq.quantity_available})
                                    {!isCountable && <span className="ml-1 text-xs text-purple-600 font-medium">(Decoration – 1 per event)</span>}
                                    {hasPaxPerUnit && <span className="ml-1 text-xs text-blue-600 font-medium">(Auto: 1 per {eq.pax_per_unit} pax)</span>}
                                    {isCountable && !hasPaxPerUnit && <span className="ml-1 text-xs text-amber-600 font-medium">(Countable – no pax-per-unit set)</span>}
                                  </label>
                                  {isSelected && (
                                    hasPaxPerUnit ? (
                                      <span className="text-xs text-slate-400 italic whitespace-nowrap" title="Calculated automatically from guest count when a booking is approved — this quantity isn't used.">
                                        Auto-calculated
                                      </span>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <label className="text-xs text-slate-600">Qty (max {eq.quantity_available}):</label>
                                        <input type="number" min="1" max={eq.quantity_available}
                                          value={currentQty}
                                          onChange={(e) => onEquipmentQuantityChange(eq.equipment_id, e.target.value)}
                                          className={`w-16 border rounded p-1 text-sm ${exceedsStock ? 'border-red-400 focus:ring-1 focus:ring-red-300' : 'border-slate-300'}`}
                                          disabled={isSubmitting} />
                                      </div>
                                    )
                                  )}
                                </div>
                                {exceedsStock && (
                                  <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1 pl-6">
                                    <AlertTriangle size={12} /> Only {eq.quantity_available} in stock — lower this before saving.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          <span className="font-semibold">Countable</span> items with a pax-per-unit set scale automatically — the quantity you'd type isn't used.{' '}
                          <span className="font-semibold">Decoration</span> items and misconfigured Countable items (no pax-per-unit) use the quantity you enter directly.
                        </p>
                      </>
                    )}
                  </div>
                </FormSection>
              </div>
            )}

            {/* Menu Item Fields */}
            {modalType === 'Menu Item' && (
              <FormSection title="Basic Info">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Menu Title *</label>
                    <input type="text" name="title" value={formData.title} onChange={onInputChange}
                      placeholder="e.g. Shrimp Dish"
                      className={`w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${
                        duplicateWarning ? 'border-amber-400 focus:ring-amber-200 focus:border-amber-400' : 'border-slate-300 focus:ring-[#008A45] focus:border-[#008A45]'
                      }`}
                      required disabled={isSubmitting} />
                    {duplicateWarning && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertTriangle size={12} /> A menu item named "{formData.title}" already exists.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Price <span className="font-normal text-slate-500">(per tray) *</span></label>
                    <input type="number" name="price" value={formData.price} onChange={onInputChange}
                      placeholder="e.g. 150"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                      required disabled={isSubmitting} />
                    <p className="text-xs text-slate-400 mt-1">Each tray serves 35‑50 pax.</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category *</label>
                  <Select name="categoryId" value={formData.categoryId} onChange={onInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none bg-white"
                    required disabled={isSubmitting}>
                    <option value="">Select Category</option>
                    {categories.map(cat => <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>)}
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Description *</label>
                  <textarea name="description" value={formData.description} onChange={onInputChange}
                    placeholder="Describe the menu item..." rows="3"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                    required disabled={isSubmitting} />
                </div>
              </FormSection>
            )}

            {/* Image Upload - Required for NEW items */}
            <FormSection title="Media">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Upload Image
                  {!editingId && <span className="text-red-500 ml-1">*</span>}
                  {editingId && <span className="text-xs font-normal text-slate-400 ml-1">(leave empty to keep current)</span>}
                </label>
                <div className="flex gap-3 items-start">
                  {imagePreviewUrl && (
                    <img
                      src={imagePreviewUrl}
                      alt="Preview"
                      className="w-20 h-20 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                  )}
                  <label className={`flex-1 border-2 border-dashed border-slate-300 rounded-lg h-20 flex flex-col items-center justify-center text-slate-400 bg-slate-50 transition-colors relative overflow-hidden ${isSubmitting ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:bg-slate-100'}`}>
                    <input type="file" name="imageFile" accept="image/*" onChange={onInputChange}
                      disabled={isSubmitting} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait" />
                    {formData.imageFile ? (
                      <span className="text-sm font-medium text-[#008A45] px-2 text-center">{formData.imageFile.name}</span>
                    ) : (
                      <>
                        <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs font-medium text-center px-2">{editingId ? 'Click to update image (optional)' : 'Click to upload image (required)'}</span>
                      </>
                    )}
                  </label>
                </div>
                {!editingId && !formData.imageFile && <span className="text-xs text-red-400 mt-1 block">* Required for new items</span>}
              </div>
            </FormSection>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={isSubmitting}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">Cancel</button>
          <button type="submit" form="item-form" disabled={isSubmitting}
            className="px-5 py-2.5 text-sm font-bold text-white bg-[#008A45] rounded-lg hover:bg-[#007038] transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2">
            {isSubmitting && <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>}
            {isSubmitting ? 'Saving...' : (editingId ? 'Save Changes' : `Create ${modalType}`)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
