// src/pages/PackagesAndMenus/index.jsx
import { useState, useEffect } from 'react';
import Select from '../../components/Select';
import { Search } from 'lucide-react';
import { supabase } from '../../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { usePasswordConfirm } from '../../contexts/PasswordConfirmContext';
import { DEFAULT_COLORS, EMPTY_FORM_DATA } from './constants';
import PackageCard from './PackageCard';
import MenuItemCard from './MenuItemCard';
import ItemFormModal from './ItemFormModal';
import CategoryManagerModal from './CategoryManagerModal';

export default function PackagesAndMenus() {
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [activeTab, setActiveTab] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [packages, setPackages] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [packageEquipment, setPackageEquipment] = useState({});
  const [packageCategories, setPackageCategories] = useState({});
  const [packageCategoryIds, setPackageCategoryIds] = useState({});

  // --- Search/filter — search by name/description, plus a category filter
  // (checks a menu item's own category, or a package's included categories).
  // Pricing Type only makes sense for packages (menu items have no pricing
  // type of their own), so it's kept separate and only shown/applied on the
  // Catering Packages tab. ---
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [pricingTypeFilter, setPricingTypeFilter] = useState('All'); // 'All' | 'per_pax' | 'fixed' — packages only

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('Package');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM_DATA);
  const [newColorInput, setNewColorInput] = useState('');

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({
    category_id: null,
    category_name: '',
    category_description: '',
  });
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);

  // --- Helper ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // ========== FETCH DATA ==========
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [packagesRes, menuRes, categoriesRes, equipmentRes] = await Promise.all([
        supabase.from('package').select('*').order('pkg_name'),
        supabase.from('menu_item').select('*, category_id').order('menu_name'),
        supabase.from('category').select('*').order('category_name'),
        supabase.from('equipment').select('*').order('eqm_name'),
      ]);

      if (packagesRes.error) throw packagesRes.error;
      if (menuRes.error) throw menuRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (equipmentRes.error) throw equipmentRes.error;

      const packagesData = packagesRes.data || [];
      const menuData = menuRes.data || [];
      const categoriesData = categoriesRes.data || [];
      const equipmentData = equipmentRes.data || [];

      setPackages(packagesData);
      setMenuItems(menuData);
      setCategories(categoriesData);
      setEquipment(equipmentData);

      await fetchPackageAssociations(packagesData, equipmentData, categoriesData);
    } catch (error) {
      handleError(error, 'Unable to load catalog data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- FETCH ASSOCIATIONS ---
  const fetchPackageAssociations = async (packagesData, equipmentData, categoriesData) => {
    if (!packagesData || packagesData.length === 0) {
      setPackageEquipment({});
      setPackageCategories({});
      setPackageCategoryIds({});
      return;
    }
    const packageIds = packagesData.map(p => p.package_id);

    try {
      // --- Categories ---
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select('package_id, category_id')
        .in('package_id', packageIds);
      if (catError) throw catError;

      const catNameMap = {};
      categoriesData.forEach(c => {
        catNameMap[c.category_id] = c.category_name;
      });

      const catMap = {};
      const catIdMap = {};
      catData.forEach(row => {
        if (!catMap[row.package_id]) catMap[row.package_id] = [];
        if (!catIdMap[row.package_id]) catIdMap[row.package_id] = [];
        const name = catNameMap[row.category_id] || row.category_id;
        catMap[row.package_id].push(name);
        catIdMap[row.package_id].push(row.category_id);
      });
      setPackageCategories(catMap);
      setPackageCategoryIds(catIdMap);

      // --- Equipment ---
      const { data: equipData, error: equipError } = await supabase
        .from('package_equipment')
        .select('package_id, equipment_id, included_quantity, per_pax')
        .in('package_id', packageIds);
      if (equipError) throw equipError;

      const equipMap = {};
      equipData.forEach(row => {
        if (!equipMap[row.package_id]) equipMap[row.package_id] = [];
        const equip = equipmentData.find(e => e.equipment_id === row.equipment_id);
        equipMap[row.package_id].push({
          equipment_id: row.equipment_id,
          name: equip?.eqm_name || 'Unknown',
          quantity: row.included_quantity,
          perPax: row.per_pax,
        });
      });
      setPackageEquipment(equipMap);
    } catch (error) {
      handleError(error, 'Unable to load package associations.');
    }
  };

  // --- FETCH ASSOCIATIONS FOR EDIT ---
  const fetchPackageAssociationsForEdit = async (packageId) => {
    try {
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select('category_id')
        .eq('package_id', packageId);
      if (catError) throw catError;

      const { data: equipData, error: equipError } = await supabase
        .from('package_equipment')
        .select('equipment_id, included_quantity, per_pax')
        .eq('package_id', packageId);
      if (equipError) throw equipError;

      const selectedCategories = catData.map(row => row.category_id);
      const selectedEquipment = equipData.map(row => row.equipment_id);
      const equipmentQuantities = {};
      const equipmentPerPax = {};
      equipData.forEach(row => {
        equipmentQuantities[row.equipment_id] = row.included_quantity;
        equipmentPerPax[row.equipment_id] = row.per_pax !== undefined ? row.per_pax : true;
      });

      return { selectedCategories, selectedEquipment, equipmentQuantities, equipmentPerPax };
    } catch (error) {
      console.error('Error fetching associations for edit:', error);
      toast.error('Unable to load package details for editing.');
      return { selectedCategories: [], selectedEquipment: [], equipmentQuantities: {}, equipmentPerPax: {} };
    }
  };

  // --- HANDLERS ---
  const handleInputChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'imageFile' && files.length > 0) {
      setFormData(prev => ({ ...prev, imageFile: files[0] }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handlePricingTypeChange = (pricing_type) => {
    setFormData(prev => ({ ...prev, pricing_type }));
  };

  const handleCategorySelection = (categoryId) => {
    setFormData(prev => {
      const current = prev.selectedCategories || [];
      if (current.includes(categoryId)) {
        return { ...prev, selectedCategories: current.filter(id => id !== categoryId) };
      } else {
        return { ...prev, selectedCategories: [...current, categoryId] };
      }
    });
  };

  const handleEquipmentSelection = (equipmentId, quantity = 1) => {
    const equip = equipment.find(e => e.equipment_id === equipmentId);
    const perPax = equip?.equipment_type === 'Countable';

    setFormData(prev => {
      const current = prev.selectedEquipment || [];
      const quantities = { ...prev.equipmentQuantities };
      const perPaxMap = { ...prev.equipmentPerPax };
      if (current.includes(equipmentId)) {
        const newSelected = current.filter(id => id !== equipmentId);
        delete quantities[equipmentId];
        delete perPaxMap[equipmentId];
        return { ...prev, selectedEquipment: newSelected, equipmentQuantities: quantities, equipmentPerPax: perPaxMap };
      } else {
        return {
          ...prev,
          selectedEquipment: [...current, equipmentId],
          equipmentQuantities: { ...quantities, [equipmentId]: quantity },
          equipmentPerPax: { ...perPaxMap, [equipmentId]: perPax },
        };
      }
    });
  };

  // Doesn't force-correct what they type — the input shows a live inline
  // warning instead (see ItemFormModal) if it exceeds stock, and submit is
  // blocked by the check in validatePackageForm. Avoids toast spam while
  // someone's mid-keystroke.
  const handleEquipmentQuantityChange = (equipmentId, quantity) => {
    let parsed = parseInt(quantity) || 1;
    if (parsed < 1) parsed = 1;
    setFormData(prev => ({
      ...prev,
      equipmentQuantities: { ...prev.equipmentQuantities, [equipmentId]: parsed },
    }));
  };

  // --- Color management ---
  const handleAddColor = () => {
    const color = newColorInput.trim();
    if (!color) {
      toast.error('Please enter a color name.');
      return;
    }
    if (formData.colors && formData.colors.some(c => c.toLowerCase() === color.toLowerCase())) {
      toast.error('Color already exists.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      colors: [...(prev.colors || []), color],
    }));
    setNewColorInput('');
  };

  const handleRemoveColor = (colorToRemove) => {
    setFormData(prev => ({
      ...prev,
      colors: (prev.colors || []).filter(c => c !== colorToRemove),
    }));
  };

  // One-click add from the suggestion chips, bypassing the free-text input.
  const handleQuickAddColor = (color) => {
    setFormData(prev => {
      if ((prev.colors || []).includes(color)) return prev;
      return { ...prev, colors: [...(prev.colors || []), color] };
    });
  };

  // --- CHECK DUPLICATES ---
  const checkDuplicatePackageName = async (name, excludeId = null) => {
    let query = supabase
      .from('package')
      .select('package_id')
      .ilike('pkg_name', name.trim());

    if (excludeId) {
      query = query.neq('package_id', excludeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data && data.length > 0;
  };

  const checkDuplicateMenuItemName = async (name, excludeId = null) => {
    let query = supabase
      .from('menu_item')
      .select('menu_item_id')
      .ilike('menu_name', name.trim());

    if (excludeId) {
      query = query.neq('menu_item_id', excludeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data && data.length > 0;
  };

  const checkDuplicateCategoryName = async (name, excludeId = null) => {
    let query = supabase
      .from('category')
      .select('category_id')
      .ilike('category_name', name.trim());

    if (excludeId) {
      query = query.neq('category_id', excludeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data && data.length > 0;
  };

  // Used for live "this name is already taken" feedback while typing in
  // the Add/Edit modal, ahead of the same check that also runs on submit.
  const checkTitleDuplicate = async (title) => {
    if (!title || !title.trim()) return false;
    try {
      return modalType === 'Package'
        ? await checkDuplicatePackageName(title, editingId)
        : await checkDuplicateMenuItemName(title, editingId);
    } catch {
      return false; // don't block typing on a transient network hiccup
    }
  };

  // --- Open/Close Modal ---
  const handleOpenModal = async (type, item = null) => {
    setModalType(type);
    setEditingId(item ? (type === 'Package' ? item.package_id : item.menu_item_id) : null);

    if (item && type === 'Package') {
      const { selectedCategories, selectedEquipment, equipmentQuantities, equipmentPerPax } =
        await fetchPackageAssociationsForEdit(item.package_id);
      setFormData({
        title: item.pkg_name || '',
        price: item.pkg_price?.toString() || '',
        minPax: item.minimum_pax?.toString() || '',
        categoryId: '',
        description: item.pkg_description || '',
        imageFile: null,
        selectedCategories,
        selectedEquipment,
        equipmentQuantities,
        equipmentPerPax: equipmentPerPax || {},
        pricing_type: item.pricing_type || 'per_pax',
        max_pax: item.max_pax?.toString() || '',
        extra_pax_price: item.extra_pax_price?.toString() || '',
        colors: item.colors || [],
        existingImageUrl: item.pkg_image || null,
      });
    } else if (item && type === 'Menu Item') {
      setFormData({
        ...EMPTY_FORM_DATA,
        title: item.menu_name || '',
        price: item.menu_price?.toString() || '',
        categoryId: item.category_id || '',
        description: item.menu_description || '',
        existingImageUrl: item.menu_image || null,
      });
    } else if (type === 'Package') {
      setFormData({ ...EMPTY_FORM_DATA, colors: [...DEFAULT_COLORS] });
    } else {
      setFormData(EMPTY_FORM_DATA);
    }
    setNewColorInput('');
    setIsModalOpen(true);
  };

  const handleTypeChange = (type) => {
    setModalType(type);
    setFormData(type === 'Package' ? { ...EMPTY_FORM_DATA, colors: [...DEFAULT_COLORS] } : EMPTY_FORM_DATA);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData(EMPTY_FORM_DATA);
    setNewColorInput('');
    setIsSubmitting(false);
  };

  // ============================================================
  // ✅ VALIDATION – with duplicate check, image, and description
  // ============================================================
  const validatePackageForm = async () => {
    const { title, price, minPax, selectedCategories, selectedEquipment, equipmentQuantities, description, imageFile, pricing_type, max_pax, extra_pax_price } = formData;

    // 1. Title
    if (!title || title.trim() === '') {
      toast.error('Package title is required.');
      return false;
    }

    // 2. ✅ DUPLICATE CHECK for Package Name
    const isDuplicate = await checkDuplicatePackageName(title, editingId);
    if (isDuplicate) {
      toast.error(`A package named "${title}" already exists. Please use a different name.`);
      return false;
    }

    // 3. Price
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Package price must be greater than zero.');
      return false;
    }

    // 4. Minimum Pax
    const minPaxNum = parseInt(minPax);
    if (isNaN(minPaxNum) || minPaxNum < 1) {
      toast.error('Minimum pax must be at least 1.');
      return false;
    }

    // 4b. Fixed-pricing fields — same "shouldn't allow an impossible value"
    // trap as equipment quantity: Max Pax Included can't be below the
    // package's own Minimum Pax, and Extra Pax Price can't be negative.
    if (pricing_type === 'fixed') {
      if (max_pax !== '' && max_pax !== null && max_pax !== undefined) {
        const maxPaxNum = parseInt(max_pax);
        if (isNaN(maxPaxNum) || maxPaxNum < 1) {
          toast.error('Max Pax Included must be at least 1.');
          return false;
        }
        if (maxPaxNum < minPaxNum) {
          toast.error(`Max Pax Included (${maxPaxNum}) can't be less than Minimum Pax (${minPaxNum}).`);
          return false;
        }
      }
      if (extra_pax_price !== '' && extra_pax_price !== null && extra_pax_price !== undefined) {
        const extraPriceNum = parseFloat(extra_pax_price);
        if (isNaN(extraPriceNum) || extraPriceNum < 0) {
          toast.error('Extra Pax Price cannot be negative.');
          return false;
        }
      }
    }

    // 5. ✅ DESCRIPTION is required
    if (!description || description.trim() === '') {
      toast.error('Package description is required.');
      return false;
    }

    // 6. ✅ IMAGE is required for NEW packages (or if no existing image)
    if (!editingId && !imageFile) {
      toast.error('Please upload an image for this package.');
      return false;
    }

    // 7. At least one of Categories OR Equipment must be selected
    const hasCategories = selectedCategories && selectedCategories.length > 0;
    const hasEquipment = selectedEquipment && selectedEquipment.length > 0;

    if (!hasCategories && !hasEquipment) {
      toast.error('Package must include at least one Category (Food) or Equipment item.');
      return false;
    }

    // 8. Check equipment quantities — must be at least 1 and not exceed current stock
    if (hasEquipment) {
      for (const [equipId, qty] of Object.entries(equipmentQuantities)) {
        if (qty < 1) {
          toast.error('Equipment quantities must be at least 1.');
          return false;
        }
        const eq = equipment.find(e => e.equipment_id === equipId);
        if (eq && qty > eq.quantity_available) {
          toast.error(`"${eq.eqm_name}" quantity (${qty}) exceeds available stock (${eq.quantity_available}).`);
          return false;
        }
      }
    }

    return true;
  };

  const validateMenuItemForm = async () => {
    const { title, price, categoryId, description, imageFile } = formData;

    // 1. Title
    if (!title || title.trim() === '') {
      toast.error('Menu item title is required.');
      return false;
    }

    // 2. ✅ DUPLICATE CHECK for Menu Item Name
    const isDuplicate = await checkDuplicateMenuItemName(title, editingId);
    if (isDuplicate) {
      toast.error(`A menu item named "${title}" already exists. Please use a different name.`);
      return false;
    }

    // 3. Price
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Price must be greater than zero.');
      return false;
    }

    // 4. Category
    if (!categoryId) {
      toast.error('Please select a category.');
      return false;
    }

    // 5. ✅ DESCRIPTION is required
    if (!description || description.trim() === '') {
      toast.error('Menu item description is required.');
      return false;
    }

    // 6. ✅ IMAGE is required for NEW menu items (or if no existing image)
    if (!editingId && !imageFile) {
      toast.error('Please upload an image for this menu item.');
      return false;
    }

    return true;
  };

  // --- SUBMIT ---
  const handleSubmit = async (e) => {
    e.preventDefault();

    let isValid = false;
    if (modalType === 'Package') {
      isValid = await validatePackageForm();
    } else {
      isValid = await validateMenuItemForm();
    }
    if (!isValid) return;

    setIsSubmitting(true);

    try {
      const cleanPrice = parseFloat(formData.price) || 0;
      let uploadedImageUrl = null;

      // Upload image if a new file is selected
      if (formData.imageFile) {
        // --- FILE VALIDATION ---
        const file = formData.imageFile;
        const maxSize = 5 * 1024 * 1024; // 5 MB
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

        if (!allowedTypes.includes(file.type)) {
          toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
          setIsSubmitting(false);
          return;
        }
        if (file.size > maxSize) {
          toast.error(`File is too large. Maximum size is 5 MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)} MB.`);
          setIsSubmitting(false);
          return;
        }

        try {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `${modalType === 'Package' ? 'packages' : 'menu'}/${fileName}`;
          const { error: uploadError } = await supabase.storage
            .from('images')
            .upload(filePath, file);

          if (uploadError) {
            let msg = 'Failed to upload image.';
            if (uploadError.message?.includes('bucket not found')) msg = 'Storage bucket is not configured.';
            else if (uploadError.message?.includes('permission')) msg = 'Permission denied.';
            else if (uploadError.message?.includes('too large')) msg = 'File exceeds storage limit.';
            else if (uploadError.message?.includes('duplicate')) msg = 'A file with this name already exists.';
            throw new Error(msg);
          }

          const { data: publicUrlData } = supabase.storage
            .from('images')
            .getPublicUrl(filePath);
          uploadedImageUrl = publicUrlData.publicUrl;
        } catch (uploadErr) {
          toast.error(uploadErr.message || 'Failed to upload image. Please try again.');
          setIsSubmitting(false);
          return;
        }
      }

      if (modalType === 'Package') {
        const packageData = {
          pkg_name: formData.title.trim(),
          pkg_description: formData.description.trim(),
          pkg_price: cleanPrice,
          minimum_pax: parseInt(formData.minPax) || 0,
          pricing_type: formData.pricing_type || 'per_pax',
          max_pax: formData.pricing_type === 'fixed' ? (parseInt(formData.max_pax) || null) : null,
          extra_pax_price: formData.pricing_type === 'fixed' ? (parseFloat(formData.extra_pax_price) || 0) : 0,
          colors: formData.colors || [],
        };
        if (uploadedImageUrl) {
          packageData.pkg_image = uploadedImageUrl;
        } else if (!editingId) {
          // If no image uploaded and it's a new item, use placeholder (but validation should prevent this)
          packageData.pkg_image = 'https://via.placeholder.com/400x300?text=No+Image';
        }

        let packageId = editingId;

        if (editingId) {
          const { error } = await supabase
            .from('package')
            .update(packageData)
            .eq('package_id', editingId);
          if (error) throw error;
        } else {
          const { data: newPackage, error } = await supabase
            .from('package')
            .insert([{ ...packageData, pkg_availability: 'Available' }])
            .select();
          if (error) throw error;
          packageId = newPackage[0].package_id;
        }

        // Update categories — insert the new set FIRST, then delete only the
        // rows that predate this save (captured by id before inserting).
        // Deleting first and inserting after (the old approach) meant a
        // failed insert left the package with its categories already wiped
        // and nothing to show for it, since these aren't run in a real
        // transaction. Inserting first means a failed insert leaves the old
        // associations completely untouched.
        const { data: oldCatRows } = await supabase
          .from('package_category')
          .select('package_category_id')
          .eq('package_id', packageId);

        const selectedCatIds = formData.selectedCategories || [];
        if (selectedCatIds.length > 0) {
          const inserts = selectedCatIds.map(catId => ({ package_id: packageId, category_id: catId }));
          const { error } = await supabase.from('package_category').insert(inserts);
          if (error) throw error;
        }
        if (oldCatRows && oldCatRows.length > 0) {
          const oldCatIds = oldCatRows.map(r => r.package_category_id);
          const { error } = await supabase.from('package_category').delete().in('package_category_id', oldCatIds);
          if (error) throw error;
        }

        // Update equipment — same insert-then-delete-old ordering, for the
        // same reason.
        const { data: oldEquipRows } = await supabase
          .from('package_equipment')
          .select('package_equipment_id')
          .eq('package_id', packageId);

        const selectedEquipIds = formData.selectedEquipment || [];
        if (selectedEquipIds.length > 0) {
          const inserts = selectedEquipIds.map(equipId => ({
            package_id: packageId,
            equipment_id: equipId,
            included_quantity: formData.equipmentQuantities[equipId] || 1,
            per_pax: formData.equipmentPerPax[equipId] !== undefined ? formData.equipmentPerPax[equipId] : true,
          }));
          const { error } = await supabase.from('package_equipment').insert(inserts);
          if (error) throw error;
        }
        if (oldEquipRows && oldEquipRows.length > 0) {
          const oldEquipIds = oldEquipRows.map(r => r.package_equipment_id);
          const { error } = await supabase.from('package_equipment').delete().in('package_equipment_id', oldEquipIds);
          if (error) throw error;
        }

        toast.success(editingId ? 'Package saved.' : 'Package created.');
        await fetchData();
      } else {
        // Menu Item
        const menuData = {
          menu_name: formData.title.trim(),
          menu_price: cleanPrice,
          category_id: formData.categoryId,
          menu_description: formData.description.trim(),
        };
        if (uploadedImageUrl) {
          menuData.menu_image = uploadedImageUrl;
        } else if (!editingId) {
          menuData.menu_image = 'https://via.placeholder.com/400x300?text=No+Image';
        }

        if (editingId) {
          const { error } = await supabase
            .from('menu_item')
            .update(menuData)
            .eq('menu_item_id', editingId);
          if (error) throw error;
          toast.success('Menu item saved.');
        } else {
          const { error } = await supabase
            .from('menu_item')
            .insert([{ ...menuData, menu_availability: 'Available' }]);
          if (error) throw error;
          toast.success('Menu item created.');
        }
      }

      handleCloseModal();
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to save item.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // A menu item's real usage isn't enforced by any DB constraint — it's
  // only ever referenced from inside booking.menu_selections, a JSON blob
  // (package bookings store {category_id: menu_item_id}, short orders
  // store an array of {menu_item_id, quantity}). Since there's no FK here,
  // deleting a menu item that's part of a live/past booking would leave
  // that booking silently pointing at nothing. Scan for it client-side —
  // simplest reliable way to check both JSON shapes without a DB function.
  const checkMenuItemUsedInBookings = async (menuItemId) => {
    const { data, error } = await supabase
      .from('booking')
      .select('booking_id, menu_selections')
      .not('menu_selections', 'is', null);
    if (error) throw error;
    return (data || []).filter(b => JSON.stringify(b.menu_selections).includes(menuItemId)).length;
  };

  // --- DELETE (with foreign key checks) ---
  const handleDelete = async (id, type) => {
    const confirmed = await showConfirm({
      title: `Delete ${type}?`,
      message: `Are you sure you want to delete this ${type.toLowerCase()}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: `Deleting this ${type.toLowerCase()} is permanent. Re-enter your password to continue.`,
    });
    if (!passwordOk) return;

    try {
      if (type === 'Package') {
        const { count, error: countError } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .eq('package_id', id);
        if (countError) throw countError;
        if (count > 0) {
          toast.error(`Cannot delete this package because it is used in ${count} booking(s).`);
          return;
        }
        await supabase.from('package_category').delete().eq('package_id', id);
        await supabase.from('package_equipment').delete().eq('package_id', id);
        await supabase.from('package_menu').delete().eq('package_id', id);
        await supabase.from('package').delete().eq('package_id', id);
        toast.success('Package deleted.');
      } else {
        // package_menu is a real table in the schema, but this app's own
        // package save flow never writes to it — packages include a whole
        // CATEGORY (package_category) instead, and any available item in
        // that category becomes selectable. Kept as a harmless extra check
        // in case something else populates it, but the check that actually
        // matters for THIS app's data model is below: would deleting this
        // item leave an active package's included category with nothing
        // left to offer.
        const { count, error: countError } = await supabase
          .from('package_menu')
          .select('*', { count: 'exact', head: true })
          .eq('menu_item_id', id);
        if (countError) throw countError;
        if (count > 0) {
          toast.error(`Cannot delete this menu item because it is included in ${count} package(s).`);
          return;
        }

        const target = menuItems.find(m => m.menu_item_id === id);
        if (target?.category_id) {
          const siblingCount = menuItems.filter(m =>
            m.category_id === target.category_id && m.menu_item_id !== id && m.menu_availability !== 'Archived'
          ).length;
          if (siblingCount === 0) {
            const { count: packageCategoryCount, error: categoryError } = await supabase
              .from('package_category')
              .select('*', { count: 'exact', head: true })
              .eq('category_id', target.category_id);
            if (categoryError) throw categoryError;
            if (packageCategoryCount > 0) {
              toast.error(`Cannot delete this menu item — it's the last available item in its category, which is included in ${packageCategoryCount} package(s). Add another item to the category first, or archive this one instead.`);
              return;
            }
          }
        }

        const bookingUsageCount = await checkMenuItemUsedInBookings(id);
        if (bookingUsageCount > 0) {
          toast.error(`Cannot delete this menu item because it appears in ${bookingUsageCount} existing booking(s). Archive it instead to hide it from new orders while keeping booking history intact.`);
          return;
        }

        await supabase.from('menu_item').delete().eq('menu_item_id', id);
        toast.success('Menu item deleted.');
      }
      await fetchData();
    } catch (error) {
      handleError(error, `Failed to delete ${type.toLowerCase()}.`);
    }
  };

  // --- TOGGLE ARCHIVE ---
  const toggleArchive = async (id, type) => {
    const confirmed = await showConfirm({
      title: type === 'package' ? 'Archive Package?' : 'Archive Menu Item?',
      message: type === 'package'
        ? 'Are you sure you want to archive this package? It will be hidden from customers.'
        : 'Are you sure you want to archive this menu item? It will be hidden from customers.',
      confirmLabel: 'Archive',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;

    try {
      if (type === 'package') {
        const target = packages.find(p => p.package_id === id);
        const newStatus = target?.pkg_availability === 'Archived' ? 'Available' : 'Archived';
        const { error } = await supabase
          .from('package')
          .update({ pkg_availability: newStatus })
          .eq('package_id', id);
        if (error) throw error;
        toast.success(`Package ${newStatus === 'Archived' ? 'archived' : 'unarchived'}.`);
      } else {
        const target = menuItems.find(m => m.menu_item_id === id);
        const newStatus = target?.menu_availability === 'Archived' ? 'Available' : 'Archived';
        const { error } = await supabase
          .from('menu_item')
          .update({ menu_availability: newStatus })
          .eq('menu_item_id', id);
        if (error) throw error;
        toast.success(`Menu item ${newStatus === 'Archived' ? 'archived' : 'unarchived'}.`);
      }
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update status.');
    }
  };

  // --- CATEGORY MANAGEMENT ---
  const handleOpenCategoryModal = (category = null) => {
    setCategoryForm({
      category_id: category?.category_id || null,
      category_name: category?.category_name || '',
      category_description: category?.category_description || '',
    });
    setIsCategoryModalOpen(true);
  };

  const handleCategoryFormChange = (e) => {
    const { name, value } = e.target;
    setCategoryForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();

    const name = categoryForm.category_name.trim();
    if (!name) {
      toast.error('Category name is required.');
      return;
    }

    setIsCategorySubmitting(true);
    try {
      // ✅ DUPLICATE CHECK for Category Name (case-insensitive)
      const isDuplicate = await checkDuplicateCategoryName(name, categoryForm.category_id);
      if (isDuplicate) {
        toast.error(`A category named "${name}" already exists. Please use a different name.`);
        setIsCategorySubmitting(false);
        return;
      }

      const data = {
        category_name: name,
        category_description: categoryForm.category_description || '',
      };
      if (categoryForm.category_id) {
        const { error } = await supabase
          .from('category')
          .update(data)
          .eq('category_id', categoryForm.category_id);
        if (error) throw error;
        toast.success('Category saved.');
      } else {
        const { error } = await supabase
          .from('category')
          .insert([data]);
        if (error) throw error;
        toast.success('Category added.');
      }
      setIsCategoryModalOpen(false);
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to save category.');
    } finally {
      setIsCategorySubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    // ✅ USAGE CHECK — categories can be referenced by menu items and by
    // packages (via package_category); deleting one out from under either
    // would either fail with a raw DB foreign-key error or, worse, silently
    // orphan those references. Same pattern as the package/menu delete guards.
    try {
      const [{ count: menuItemCount, error: menuItemError }, { count: packageCount, error: packageError }] = await Promise.all([
        supabase.from('menu_item').select('*', { count: 'exact', head: true }).eq('category_id', categoryId),
        supabase.from('package_category').select('*', { count: 'exact', head: true }).eq('category_id', categoryId),
      ]);
      if (menuItemError) throw menuItemError;
      if (packageError) throw packageError;

      if (menuItemCount > 0) {
        toast.error(`Cannot delete this category because ${menuItemCount} menu item(s) still use it. Move or delete them first.`);
        return;
      }
      if (packageCount > 0) {
        toast.error(`Cannot delete this category because ${packageCount} package(s) still include it. Remove it from those packages first.`);
        return;
      }
    } catch (error) {
      handleError(error, 'Unable to check whether this category is in use.');
      return;
    }

    const confirmed = await showConfirm({
      title: 'Delete Category?',
      message: 'Are you sure you want to delete this category? This cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this category is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error } = await supabase
        .from('category')
        .delete()
        .eq('category_id', categoryId);
      if (error) throw error;
      toast.success('Category deleted.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete category.');
    }
  };

  // --- FILTER LOGIC ---
  const getDisplayedPackages = () => {
    let list;
    if (activeTab === 'Archived') list = packages.filter(p => p.pkg_availability === 'Archived');
    else if (activeTab === 'Catering Packages') list = packages.filter(p => p.pkg_availability !== 'Archived');
    else list = packages;

    if (categoryFilter !== 'All') {
      list = list.filter(p => (packageCategoryIds[p.package_id] || []).includes(categoryFilter));
    }
    if (pricingTypeFilter !== 'All') {
      list = list.filter(p => (p.pricing_type || 'per_pax') === pricingTypeFilter);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      list = list.filter(p =>
        (p.pkg_name || '').toLowerCase().includes(term) ||
        (p.pkg_description || '').toLowerCase().includes(term)
      );
    }
    return list;
  };

  const getDisplayedMenuItems = () => {
    let list;
    if (activeTab === 'Archived') list = menuItems.filter(m => m.menu_availability === 'Archived');
    else if (activeTab === 'Menu Items') list = menuItems.filter(m => m.menu_availability !== 'Archived');
    else if (activeTab === 'All') list = menuItems;
    else list = [];

    if (categoryFilter !== 'All') {
      list = list.filter(m => m.category_id === categoryFilter);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      list = list.filter(m =>
        (m.menu_name || '').toLowerCase().includes(term) ||
        (m.menu_description || '').toLowerCase().includes(term)
      );
    }
    return list;
  };

  const displayedPackages = getDisplayedPackages();
  const displayedMenuItems = getDisplayedMenuItems();
  const showPackages = activeTab === 'All' || activeTab === 'Catering Packages' || activeTab === 'Archived';
  const showMenuItems = activeTab === 'All' || activeTab === 'Menu Items' || (activeTab === 'Archived' && displayedMenuItems.length > 0);

  const isPackagesTab = activeTab === 'Catering Packages';
  const isMenuItemsTab = activeTab === 'Menu Items';

  const activeCatalogFilterCount = (searchTerm.trim() ? 1 : 0)
    + (categoryFilter !== 'All' ? 1 : 0)
    + (isPackagesTab && pricingTypeFilter !== 'All' ? 1 : 0);

  const clearCatalogFilters = () => {
    setSearchTerm('');
    setCategoryFilter('All');
    setPricingTypeFilter('All');
  };

  // Switching tabs resets the search/category so a filter picked while
  // looking at packages doesn't silently keep hiding menu items (and vice
  // versa) — Pricing Type is packages-only so it's always reset here too.
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchTerm('');
    setCategoryFilter('All');
    setPricingTypeFilter('All');
  };

  // --- Stat counts — always over the FULL dataset, not the current tab/
  // filter, so the cards read as "how many exist" rather than shifting
  // around every time a filter changes. ---
  const totalActivePackages = packages.filter(p => p.pkg_availability !== 'Archived').length;
  const totalActiveMenuItems = menuItems.filter(m => m.menu_availability !== 'Archived').length;
  const totalArchived = packages.filter(p => p.pkg_availability === 'Archived').length
    + menuItems.filter(m => m.menu_availability === 'Archived').length;

  // --- useEffect to load data on mount ---
  useEffect(() => {
    fetchData();
  }, []);

  // ========== RENDER ==========
  return (
    <div className="space-y-6 relative pb-12">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packages & Menu</h1>
          <p className="text-sm text-slate-500">
            Manage catering packages and short‑order menu items.
            <span className="block text-xs text-slate-400 mt-1">
              Menu items for short orders are priced <strong>per tray</strong> – each tray serves 35‑50 pax.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleOpenCategoryModal()}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Manage Categories
          </button>
          <button
            onClick={() => handleOpenModal('Package')}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Add An Item
          </button>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => handleTabChange('Catering Packages')}
          className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Packages</p>
          <h3 className="text-3xl font-extrabold text-[#008A45]">{totalActivePackages}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors mt-1">Click to view</p>
        </button>
        <button
          onClick={() => handleTabChange('Menu Items')}
          className="bg-white border border-slate-200 border-l-4 border-l-blue-500 rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Menu Items</p>
          <h3 className="text-3xl font-extrabold text-blue-700">{totalActiveMenuItems}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-blue-600 transition-colors mt-1">Click to view</p>
        </button>
        <button
          onClick={() => handleTabChange('Archived')}
          className="bg-white border border-slate-200 border-l-4 border-l-slate-400 rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Archived</p>
          <h3 className="text-3xl font-extrabold text-slate-600">{totalArchived}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-slate-600 transition-colors mt-1">Click to view</p>
        </button>
      </div>

      {/* SEARCH / FILTER — the options shown depend on which tab is active:
      Catering Packages gets a Pricing Type filter (packages have one, menu
      items don't), Menu Items gets just Category (a menu item only ever
      belongs to one category, unlike a package which can span several).
      All/Archived mix both types, so they get the generic combined set. */}
      <div className={`bg-white rounded-2xl border p-4 flex flex-wrap items-center gap-3 ${activeCatalogFilterCount > 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
        {activeCatalogFilterCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
            {activeCatalogFilterCount} active
          </span>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={isPackagesTab ? 'Search packages by name or description...' : isMenuItemsTab ? 'Search menu items by name or description...' : 'Search by name or description...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${searchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
          />
        </div>
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          title={isPackagesTab ? 'Filter by a category included in the package' : 'Filter by category'}
          className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${categoryFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
        >
          <option value="All">All categories</option>
          {categories.map(cat => (
            <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
          ))}
        </Select>
        {isPackagesTab && (
          <Select
            value={pricingTypeFilter}
            onChange={(e) => setPricingTypeFilter(e.target.value)}
            title="Filter by pricing type"
            className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${pricingTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
          >
            <option value="All">All pricing types</option>
            <option value="per_pax">Per Pax</option>
            <option value="fixed">Fixed Price</option>
          </Select>
        )}
        {activeCatalogFilterCount > 0 && (
          <button
            onClick={clearCatalogFilters}
            className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* TABS */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {['All', 'Catering Packages', 'Menu Items', 'Archived'].map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`
                whitespace-nowrap py-3 px-1 border-b-2 font-semibold text-sm transition-colors
                ${activeTab === tab
                  ? 'border-[#008A45] text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
              `}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* CONTENT */}
      {isLoading ? (
        <div className="w-full py-20 flex justify-center items-center text-slate-400 font-medium animate-pulse">
          <svg className="w-6 h-6 mr-2 animate-spin text-[#008A45]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading catalog data...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Packages */}
          {showPackages && (
            <div className="space-y-4">
              {(activeTab === 'All' || activeTab === 'Catering Packages') && (
                <h3 className="text-lg font-bold text-slate-900 border-b pb-2">Catering Packages</h3>
              )}
              {displayedPackages.length === 0 && (
                <p className="text-sm text-slate-500 italic">
                  {activeCatalogFilterCount > 0 ? 'No packages match your search/filter.' : 'No packages found.'}
                </p>
              )}
              {displayedPackages.map((pkg) => (
                <PackageCard
                  key={pkg.package_id}
                  pkg={pkg}
                  categoryNames={packageCategories[pkg.package_id] || []}
                  equipmentNames={packageEquipment[pkg.package_id] || []}
                  onEdit={(p) => handleOpenModal('Package', p)}
                  onArchive={(id) => toggleArchive(id, 'package')}
                  onDelete={(id) => handleDelete(id, 'Package')}
                />
              ))}
            </div>
          )}

          {/* Menu Items */}
          {showMenuItems && (
            <div className={`${activeTab === 'Archived' && displayedPackages.length > 0 ? 'border-t pt-8' : ''}`}>
              {(activeTab === 'All' || activeTab === 'Archived') && (
                <h3 className="text-lg font-bold text-slate-900 mb-4 border-b pb-2">
                  {activeTab === 'Archived' ? 'Archived Menu Items' : 'Individual Menu Items (Short Orders)'}
                </h3>
              )}
              {activeTab === 'Menu Items' && (
                <h3 className="text-lg font-bold text-slate-900 mb-4 border-b pb-2">Individual Menu Items (Short Orders)</h3>
              )}
              {displayedMenuItems.length === 0 ? (
                <p className="text-sm text-slate-500 italic">
                  {activeCatalogFilterCount > 0 ? 'No menu items match your search/filter.' : 'No menu items found.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {displayedMenuItems.map((item) => (
                    <MenuItemCard
                      key={item.menu_item_id}
                      item={item}
                      categoryName={categories.find(c => c.category_id === item.category_id)?.category_name}
                      onEdit={(i) => handleOpenModal('Menu Item', i)}
                      onArchive={(id) => toggleArchive(id, 'menu')}
                      onDelete={(id) => handleDelete(id, 'Menu Item')}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ItemFormModal
        isOpen={isModalOpen}
        modalType={modalType}
        editingId={editingId}
        formData={formData}
        categories={categories}
        equipment={equipment}
        isSubmitting={isSubmitting}
        newColorInput={newColorInput}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        onInputChange={handleInputChange}
        onTypeChange={handleTypeChange}
        onCategorySelection={handleCategorySelection}
        onEquipmentSelection={handleEquipmentSelection}
        onEquipmentQuantityChange={handleEquipmentQuantityChange}
        onColorInputChange={(e) => setNewColorInput(e.target.value)}
        onAddColor={handleAddColor}
        onRemoveColor={handleRemoveColor}
        onQuickAddColor={handleQuickAddColor}
        onPricingTypeChange={handlePricingTypeChange}
        onCheckDuplicateTitle={checkTitleDuplicate}
      />

      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        categories={categories}
        categoryForm={categoryForm}
        isCategorySubmitting={isCategorySubmitting}
        onClose={() => setIsCategoryModalOpen(false)}
        onEdit={(cat) => handleOpenCategoryModal(cat)}
        onDelete={handleDeleteCategory}
        onFormChange={handleCategoryFormChange}
        onSubmit={handleCategorySubmit}
        onCancelEdit={() => setCategoryForm({ category_id: null, category_name: '', category_description: '' })}
      />
    </div>
  );
}
