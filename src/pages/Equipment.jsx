// src/pages/PackagesAndMenus.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

// Default colors for new packages
const DEFAULT_COLORS = [
  'Burgundy', 'Navy Blue', 'Emerald Green', 'Gold', 'Silver', 'White',
  'Cream', 'Blush Pink', 'Lavender', 'Champagne', 'Mint Green', 'Peach',
];

export default function PackagesAndMenus() {
  const { showConfirm } = useConfirm();
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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('Package');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    price: '',
    minPax: '',
    categoryId: '',
    description: '',
    imageFile: null,
    selectedCategories: [],
    selectedEquipment: [],
    equipmentQuantities: {},
    equipmentPerPax: {},
    pricing_type: 'per_pax',
    max_pax: '',
    extra_pax_price: '',
    colors: [],
  });
  const [newColorInput, setNewColorInput] = useState('');

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({
    category_id: null,
    category_name: '',
    category_description: '',
  });
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- FETCH DATA ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch packages
      const { data: packagesData, error: packagesError } = await supabase
        .from('package')
        .select('*')
        .order('pkg_name');
      if (packagesError) throw packagesError;
      setPackages(packagesData || []);

      // Fetch menu items
      const { data: menuData, error: menuError } = await supabase
        .from('menu_item')
        .select('*, category:category_id(*)')
        .order('menu_name');
      if (menuError) throw menuError;
      setMenuItems(menuData || []);

      // Fetch categories
      const { data: categoryData, error: categoryError } = await supabase
        .from('category')
        .select('*')
        .order('category_name');
      if (categoryError) throw categoryError;
      setCategories(categoryData || []);

      // Fetch equipment
      const { data: equipData, error: equipError } = await supabase
        .from('equipment')
        .select('*')
        .order('eqm_name');
      if (equipError) throw equipError;
      setEquipment(equipData || []);

      // Fetch package associations
      await fetchPackageAssociations(packagesData || []);
    } catch (error) {
      handleError(error, 'Unable to load data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- FETCH ASSOCIATIONS (categories & equipment per package) ---
  const fetchPackageAssociations = async (packagesData) => {
    if (!packagesData || packagesData.length === 0) {
      setPackageCategories({});
      setPackageEquipment({});
      return;
    }
    const packageIds = packagesData.map(p => p.package_id);

    try {
      // Categories
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select('package_id, category_id')
        .in('package_id', packageIds);
      if (catError) throw catError;

      const catMap = {};
      catData.forEach(row => {
        if (!catMap[row.package_id]) catMap[row.package_id] = [];
        catMap[row.package_id].push(row.category_id);
      });
      setPackageCategories(catMap);

      // Equipment
      const { data: equipData, error: equipError } = await supabase
        .from('package_equipment')
        .select('package_id, equipment_id, included_quantity, per_pax')
        .in('package_id', packageIds);
      if (equipError) throw equipError;

      const equipMap = {};
      equipData.forEach(row => {
        if (!equipMap[row.package_id]) equipMap[row.package_id] = [];
        equipMap[row.package_id].push({
          equipment_id: row.equipment_id,
          quantity: row.included_quantity,
          perPax: row.per_pax,
        });
      });
      setPackageEquipment(equipMap);
    } catch (error) {
      handleError(error, 'Unable to load package associations.');
    }
  };

  // Fetch associations for a single package (for edit modal)
  const fetchPackageAssociationsForEdit = async (packageId) => {
    try {
      // Categories
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select('category_id')
        .eq('package_id', packageId);
      if (catError) throw catError;
      const selectedCategories = catData.map(row => row.category_id);

      // Equipment
      const { data: equipData, error: equipError } = await supabase
        .from('package_equipment')
        .select('equipment_id, included_quantity, per_pax')
        .eq('package_id', packageId);
      if (equipError) throw equipError;
      const selectedEquipment = equipData.map(row => row.equipment_id);
      const equipmentQuantities = {};
      const equipmentPerPax = {};
      equipData.forEach(row => {
        equipmentQuantities[row.equipment_id] = row.included_quantity;
        equipmentPerPax[row.equipment_id] = row.per_pax;
      });

      return { selectedCategories, selectedEquipment, equipmentQuantities, equipmentPerPax };
    } catch (error) {
      handleError(error, 'Unable to load package associations.');
      return null;
    }
  };

  // --- HANDLERS (with validations) ---
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
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

  const handleEquipmentQuantityChange = (equipmentId, quantity) => {
    const qty = parseInt(quantity) || 1;
    if (qty < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      equipmentQuantities: { ...prev.equipmentQuantities, [equipmentId]: qty },
    }));
  };

  // --- Color management ---
  const handleAddColor = () => {
    const color = newColorInput.trim();
    if (!color) {
      toast.error('Please enter a color name.');
      return;
    }
    if (formData.colors.includes(color)) {
      toast.error('Color already added.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      colors: [...prev.colors, color],
    }));
    setNewColorInput('');
  };

  const handleRemoveColor = (colorToRemove) => {
    setFormData(prev => ({
      ...prev,
      colors: prev.colors.filter(c => c !== colorToRemove),
    }));
  };

  // --- Open modal ---
  const handleOpenModal = async (type, item = null) => {
    setModalType(type);
    setEditingId(item ? item.package_id || item.menu_item_id : null);

    // Reset form
    setFormData({
      title: '',
      price: '',
      minPax: '',
      categoryId: '',
      description: '',
      imageFile: null,
      selectedCategories: [],
      selectedEquipment: [],
      equipmentQuantities: {},
      equipmentPerPax: {},
      pricing_type: 'per_pax',
      max_pax: '',
      extra_pax_price: '',
      colors: [],
    });

    if (item) {
      if (type === 'Package') {
        setFormData(prev => ({
          ...prev,
          title: item.pkg_name || '',
          price: item.pkg_price || '',
          minPax: item.minimum_pax || '',
          description: item.pkg_description || '',
          pricing_type: item.pricing_type || 'per_pax',
          max_pax: item.max_pax || '',
          extra_pax_price: item.extra_pax_price || '',
          colors: item.colors || [],
        }));
        // Fetch associations
        const associations = await fetchPackageAssociationsForEdit(item.package_id);
        if (associations) {
          setFormData(prev => ({
            ...prev,
            selectedCategories: associations.selectedCategories || [],
            selectedEquipment: associations.selectedEquipment || [],
            equipmentQuantities: associations.equipmentQuantities || {},
            equipmentPerPax: associations.equipmentPerPax || {},
          }));
        }
      } else {
        // Menu Item
        setFormData(prev => ({
          ...prev,
          title: item.menu_name || '',
          price: item.menu_price || '',
          categoryId: item.category_id || '',
        }));
      }
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({
      title: '',
      price: '',
      minPax: '',
      categoryId: '',
      description: '',
      imageFile: null,
      selectedCategories: [],
      selectedEquipment: [],
      equipmentQuantities: {},
      equipmentPerPax: {},
      pricing_type: 'per_pax',
      max_pax: '',
      extra_pax_price: '',
      colors: [],
    });
  };

  // --- VALIDATION for package form ---
  const validatePackageForm = () => {
    const { title, price, minPax, selectedCategories, selectedEquipment, equipmentQuantities } = formData;
    if (!title || title.trim() === '') {
      toast.error('Package title is required.');
      return false;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Package price must be greater than zero.');
      return false;
    }
    const minPaxNum = parseInt(minPax);
    if (isNaN(minPaxNum) || minPaxNum < 1) {
      toast.error('Minimum pax must be at least 1.');
      return false;
    }
    if (!selectedCategories || selectedCategories.length === 0) {
      toast.error('Please select at least one category for this package.');
      return false;
    }
    // Check equipment quantities
    for (const [equipId, qty] of Object.entries(equipmentQuantities)) {
      if (qty < 1) {
        toast.error('Equipment quantities must be at least 1.');
        return false;
      }
    }
    return true;
  };

  const validateMenuItemForm = () => {
    const { title, price, categoryId } = formData;
    if (!title || title.trim() === '') {
      toast.error('Menu item title is required.');
      return false;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Price must be greater than zero.');
      return false;
    }
    if (!categoryId) {
      toast.error('Please select a category.');
      return false;
    }
    return true;
  };

  // --- SUBMIT (with validation) ---
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate based on type
    if (modalType === 'Package') {
      if (!validatePackageForm()) return;
    } else {
      if (!validateMenuItemForm()) return;
    }

    setIsSubmitting(true);

    try {
      const cleanPrice = parseFloat(formData.price) || 0;
      let uploadedImageUrl = null;

      if (formData.imageFile) {
        try {
          const file = formData.imageFile;
          if (!file.type.startsWith('image/')) {
            toast.error('Please upload a valid image file.');
            setIsSubmitting(false);
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            toast.error('Image size must be less than 5MB.');
            setIsSubmitting(false);
            return;
          }

          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `${modalType === 'Package' ? 'packages' : 'menu'}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('images')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase.storage
            .from('images')
            .getPublicUrl(filePath);

          uploadedImageUrl = publicUrlData.publicUrl;
        } catch (uploadErr) {
          handleError(uploadErr, 'Failed to upload image. Please try again.');
          setIsSubmitting(false);
          return;
        }
      }

      if (modalType === 'Package') {
        const packageData = {
          pkg_name: formData.title.trim(),
          pkg_description: formData.description?.trim() || 'No description provided.',
          pkg_price: cleanPrice,
          minimum_pax: parseInt(formData.minPax) || 0,
          pricing_type: formData.pricing_type || 'per_pax',
          max_pax: formData.pricing_type === 'fixed' ? (parseInt(formData.max_pax) || null) : null,
          extra_pax_price: formData.pricing_type === 'fixed' ? (parseFloat(formData.extra_pax_price) || 0) : 0,
          colors: formData.colors || [],
        };
        if (uploadedImageUrl) packageData.pkg_image = uploadedImageUrl;

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

        // Update categories
        const { error: deleteCatError } = await supabase
          .from('package_category')
          .delete()
          .eq('package_id', packageId);
        if (deleteCatError) throw deleteCatError;

        const selectedCatIds = formData.selectedCategories || [];
        if (selectedCatIds.length > 0) {
          const inserts = selectedCatIds.map(catId => ({
            package_id: packageId,
            category_id: catId,
          }));
          const { error: insertCatError } = await supabase
            .from('package_category')
            .insert(inserts);
          if (insertCatError) throw insertCatError;
        }

        // Update equipment with per_pax
        const { error: deleteEquipError } = await supabase
          .from('package_equipment')
          .delete()
          .eq('package_id', packageId);
        if (deleteEquipError) throw deleteEquipError;

        const selectedEquipIds = formData.selectedEquipment || [];
        if (selectedEquipIds.length > 0) {
          const inserts = selectedEquipIds.map(equipId => ({
            package_id: packageId,
            equipment_id: equipId,
            included_quantity: formData.equipmentQuantities[equipId] || 1,
            per_pax: formData.equipmentPerPax[equipId] !== undefined ? formData.equipmentPerPax[equipId] : true,
          }));
          const { error: insertEquipError } = await supabase
            .from('package_equipment')
            .insert(inserts);
          if (insertEquipError) throw insertEquipError;
        }

        toast.success(editingId ? 'Package updated successfully!' : 'Package created successfully!');
        await fetchData();

      } else {
        // Menu Item
        const menuData = {
          menu_name: formData.title.trim(),
          menu_price: cleanPrice,
          category_id: formData.categoryId,
        };
        if (uploadedImageUrl) menuData.menu_image = uploadedImageUrl;

        if (editingId) {
          const { error } = await supabase
            .from('menu_item')
            .update(menuData)
            .eq('menu_item_id', editingId);
          if (error) throw error;
          toast.success('Menu item updated successfully!');
        } else {
          const { error } = await supabase
            .from('menu_item')
            .insert([{ ...menuData, menu_availability: 'Available' }]);
          if (error) throw error;
          toast.success('Menu item created successfully!');
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

  // --- DELETE ---
  const handleDelete = async (id, type) => {
    const confirmed = await showConfirm({
      title: `Delete ${type}?`,
      message: `Are you sure you want to delete this ${type.toLowerCase()}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const table = type === 'Package' ? 'package' : 'menu_item';
      const idField = type === 'Package' ? 'package_id' : 'menu_item_id';
      const { error } = await supabase
        .from(table)
        .delete()
        .eq(idField, id);
      if (error) throw error;

      toast.success(`${type} deleted.`);
      await fetchData();
    } catch (error) {
      handleError(error, `Failed to delete ${type.toLowerCase()}.`);
    }
  };

  // --- TOGGLE ARCHIVE ---
  const toggleArchive = async (id, type) => {
    const currentItem = type === 'Package'
      ? packages.find(p => p.package_id === id)
      : menuItems.find(m => m.menu_item_id === id);
    const newStatus = currentItem.pkg_availability === 'Available' ? 'Archived' : 'Available';

    try {
      const table = type === 'Package' ? 'package' : 'menu_item';
      const idField = type === 'Package' ? 'package_id' : 'menu_item_id';
      const statusField = type === 'Package' ? 'pkg_availability' : 'menu_availability';
      const { error } = await supabase
        .from(table)
        .update({ [statusField]: newStatus })
        .eq(idField, id);
      if (error) throw error;

      toast.success(`Item ${newStatus.toLowerCase()}.`);
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
    setIsCategorySubmitting(true);

    try {
      const { category_id, category_name, category_description } = categoryForm;
      if (!category_name.trim()) {
        toast.error('Category name is required.');
        return;
      }

      if (category_id) {
        // Update
        const { error } = await supabase
          .from('category')
          .update({ category_name: category_name.trim(), category_description: category_description.trim() })
          .eq('category_id', category_id);
        if (error) throw error;
        toast.success('Category updated.');
      } else {
        // Insert
        const { error } = await supabase
          .from('category')
          .insert([{ category_name: category_name.trim(), category_description: category_description.trim() }]);
        if (error) throw error;
        toast.success('Category created.');
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
    const confirmed = await showConfirm({
      title: 'Delete Category?',
      message: 'Are you sure you want to delete this category? This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('category')
        .delete()
        .eq('category_id', categoryId);
      if (error) throw error;
      toast.success('Category deleted.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete category. It may be in use.');
    }
  };

  // --- FILTER LOGIC ---
  const getDisplayedPackages = () => {
    if (activeTab === 'All') return packages;
    return packages.filter(p => p.pkg_availability === activeTab);
  };

  const getDisplayedMenuItems = () => {
    if (activeTab === 'All') return menuItems;
    return menuItems.filter(m => m.menu_availability === activeTab);
  };

  const renderImage = (src, alt, className = 'w-16 h-16 object-cover rounded-lg') => {
    if (!src) return <div className={`${className} bg-slate-100 flex items-center justify-center text-slate-400 text-xs`}>No image</div>;
    return <img src={src} alt={alt} className={className} />;
  };

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packages & Menus</h1>
          <p className="text-sm text-slate-500">Manage your packages, menu items, and categories</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleOpenCategoryModal()}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <span>+ Category</span>
          </button>
          <button
            onClick={() => handleOpenModal('Package')}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
          >
            <span>+ Package</span>
          </button>
          <button
            onClick={() => handleOpenModal('Menu')}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
          >
            <span>+ Menu Item</span>
          </button>
          <button
            onClick={fetchData}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        {['All', 'Available', 'Archived'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 px-1 text-sm font-semibold transition-colors ${activeTab === tab ? 'border-b-2 border-[#008A45] text-[#008A45]' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Packages Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Packages</span>
          <span className="text-xs font-normal text-slate-500">{packages.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Image</th>
                <th className="p-4 font-bold">Name</th>
                <th className="p-4 font-bold text-center">Price</th>
                <th className="p-4 font-bold text-center">Min Pax</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-center">Colors</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400">Loading packages...</td></tr>
              ) : getDisplayedPackages().length === 0 ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400 italic">No packages found.</td></tr>
              ) : (
                getDisplayedPackages().map(pkg => (
                  <tr key={pkg.package_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">{renderImage(pkg.pkg_image, pkg.pkg_name, 'w-14 h-14 object-cover rounded-lg')}</td>
                    <td className="p-4 font-bold text-slate-900">{pkg.pkg_name}</td>
                    <td className="p-4 text-center font-semibold text-[#008A45]">₱{pkg.pkg_price}</td>
                    <td className="p-4 text-center">{pkg.minimum_pax}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${pkg.pkg_availability === 'Available' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                        {pkg.pkg_availability}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        {pkg.colors && pkg.colors.map((color, idx) => (
                          <span key={idx} className="inline-block px-2 py-0.5 bg-slate-100 text-xs rounded-full text-slate-700 border border-slate-200">
                            {color}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleOpenModal('Package', pkg)}
                          className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => toggleArchive(pkg.package_id, 'Package')}
                          className="text-amber-400 hover:text-amber-600 transition-colors cursor-pointer"
                          title="Toggle archive"
                        >
                          <Archive size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(pkg.package_id, 'Package')}
                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Menu Items Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Menu Items</span>
          <span className="text-xs font-normal text-slate-500">{menuItems.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Image</th>
                <th className="p-4 font-bold">Name</th>
                <th className="p-4 font-bold text-center">Price</th>
                <th className="p-4 font-bold">Category</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="6" className="p-6 text-center text-slate-400">Loading menu items...</td></tr>
              ) : getDisplayedMenuItems().length === 0 ? (
                <tr><td colSpan="6" className="p-6 text-center text-slate-400 italic">No menu items found.</td></tr>
              ) : (
                getDisplayedMenuItems().map(item => (
                  <tr key={item.menu_item_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">{renderImage(item.menu_image, item.menu_name, 'w-14 h-14 object-cover rounded-lg')}</td>
                    <td className="p-4 font-bold text-slate-900">{item.menu_name}</td>
                    <td className="p-4 text-center font-semibold text-[#008A45]">₱{item.menu_price}</td>
                    <td className="p-4">{item.category?.category_name || 'N/A'}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.menu_availability === 'Available' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                        {item.menu_availability}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleOpenModal('Menu', item)}
                          className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => toggleArchive(item.menu_item_id, 'Menu')}
                          className="text-amber-400 hover:text-amber-600 transition-colors cursor-pointer"
                          title="Toggle archive"
                        >
                          <Archive size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.menu_item_id, 'Menu')}
                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================ */}
      {/* PACKAGE / MENU MODAL          */}
      {/* ============================ */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? `Edit ${modalType}` : `Add ${modalType}`}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5 text-left">
              {/* Common fields: title, price */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Title *</label>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Price *</label>
                  <input
                    type="number"
                    name="price"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={handleInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    required
                  />
                </div>
              </div>

              {/* Package-specific fields */}
              {modalType === 'Package' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Minimum Pax *</label>
                      <input
                        type="number"
                        name="minPax"
                        min="1"
                        value={formData.minPax}
                        onChange={handleInputChange}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Pricing Type</label>
                      <select
                        name="pricing_type"
                        value={formData.pricing_type}
                        onChange={handleInputChange}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                      >
                        <option value="per_pax">Per Pax</option>
                        <option value="fixed">Fixed (with extra pax)</option>
                      </select>
                    </div>
                    {formData.pricing_type === 'fixed' && (
                      <>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">Max Pax (for fixed)</label>
                          <input
                            type="number"
                            name="max_pax"
                            min="1"
                            value={formData.max_pax}
                            onChange={handleInputChange}
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">Extra Pax Price</label>
                          <input
                            type="number"
                            name="extra_pax_price"
                            step="0.01"
                            min="0"
                            value={formData.extra_pax_price}
                            onChange={handleInputChange}
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Colors */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Colors</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.colors.map((color, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 bg-slate-100 border border-slate-300 rounded-full px-3 py-1 text-sm text-slate-700">
                          {color}
                          <button type="button" onClick={() => handleRemoveColor(color)} className="text-slate-400 hover:text-red-500">
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newColorInput}
                        onChange={(e) => setNewColorInput(e.target.value)}
                        placeholder="Add color (e.g. Burgundy)"
                        className="flex-1 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                      />
                      <button type="button" onClick={handleAddColor} className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-medium">
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Categories */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Categories *</label>
                    <div className="flex flex-wrap gap-2">
                      {categories.map(cat => (
                        <button
                          key={cat.category_id}
                          type="button"
                          onClick={() => handleCategorySelection(cat.category_id)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${formData.selectedCategories.includes(cat.category_id) ? 'bg-[#008A45] text-white border-[#008A45]' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                        >
                          {cat.category_name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Equipment */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment</label>
                    <div className="space-y-2">
                      {equipment.map(equip => {
                        const isSelected = formData.selectedEquipment.includes(equip.equipment_id);
                        const qty = formData.equipmentQuantities[equip.equipment_id] || 1;
                        const perPax = formData.equipmentPerPax[equip.equipment_id] !== undefined ? formData.equipmentPerPax[equip.equipment_id] : true;
                        return (
                          <div key={equip.equipment_id} className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200">
                            <button
                              type="button"
                              onClick={() => handleEquipmentSelection(equip.equipment_id)}
                              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${isSelected ? 'bg-[#008A45] text-white' : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'}`}
                            >
                              {isSelected ? '✓' : '+'} {equip.eqm_name}
                            </button>
                            {isSelected && (
                              <>
                                <input
                                  type="number"
                                  min="1"
                                  value={qty}
                                  onChange={(e) => handleEquipmentQuantityChange(equip.equipment_id, e.target.value)}
                                  className="w-16 border border-slate-300 rounded p-1 text-sm text-center focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                                />
                                <label className="flex items-center gap-1 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={perPax}
                                    onChange={(e) => {
                                      setFormData(prev => ({
                                        ...prev,
                                        equipmentPerPax: { ...prev.equipmentPerPax, [equip.equipment_id]: e.target.checked }
                                      }));
                                    }}
                                    className="rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]/20"
                                  />
                                  Per Pax
                                </label>
                                <span className="text-xs text-slate-400 ml-auto">
                                  {equip.equipment_type === 'Countable' ? 'Countable' : 'Decoration'}
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Menu-specific: category */}
              {modalType === 'Menu' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Category *</label>
                  <select
                    name="categoryId"
                    value={formData.categoryId}
                    onChange={handleInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    required
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Description (only for packages) */}
              {modalType === 'Package' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                  <textarea
                    name="description"
                    rows="3"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Describe the package"
                    className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  />
                </div>
              )}

              {/* Image upload */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFormData(prev => ({ ...prev, imageFile: e.target.files[0] }))}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#EAF3F2] file:text-[#008A45] hover:file:bg-[#d4e8e5]"
                />
                <p className="text-xs text-slate-400 mt-1">Max size 5MB. Supported formats: jpg, png, etc.</p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={handleCloseModal} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ============================ */}
      {/* CATEGORY MODAL               */}
      {/* ============================ */}
      {isCategoryModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">{categoryForm.category_id ? 'Edit Category' : 'Add Category'}</h2>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCategorySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Category Name *</label>
                <input
                  type="text"
                  name="category_name"
                  value={categoryForm.category_name}
                  onChange={handleCategoryFormChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                <textarea
                  name="category_description"
                  rows="3"
                  value={categoryForm.category_description}
                  onChange={handleCategoryFormChange}
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isCategorySubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isCategorySubmitting ? 'Saving...' : categoryForm.category_id ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}