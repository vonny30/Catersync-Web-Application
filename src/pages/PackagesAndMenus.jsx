// pages/PackagesAndMenus.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function PackagesAndMenus() {
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
  });

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

      setPackages(packagesRes.data || []);
      setMenuItems(menuRes.data || []);
      setCategories(categoriesRes.data || []);
      setEquipment(equipmentRes.data || []);

      await fetchPackageAssociations(packagesRes.data || []);
    } catch (error) {
      handleError(error, 'Unable to load catalog data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- FETCH ASSOCIATIONS ---
  const fetchPackageAssociations = async (packagesData) => {
    if (!packagesData || packagesData.length === 0) {
      setPackageEquipment({});
      setPackageCategories({});
      return;
    }

    const packageIds = packagesData.map(pkg => pkg.package_id);

    try {
      const { data: equipData, error: equipError } = await supabase
        .from('package_equipment')
        .select(`
          package_id,
          equipment_id,
          equipment:equipment_id (eqm_name)
        `)
        .in('package_id', packageIds);

      if (equipError) throw equipError;

      const equipmentMap = {};
      if (equipData) {
        equipData.forEach(item => {
          if (!equipmentMap[item.package_id]) equipmentMap[item.package_id] = [];
          const name = item.equipment?.eqm_name || 'Unknown';
          equipmentMap[item.package_id].push(name);
        });
      }
      setPackageEquipment(equipmentMap);

      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select(`
          package_id,
          category_id,
          category:category_id (category_name)
        `)
        .in('package_id', packageIds);

      if (catError) throw catError;

      const categoryMap = {};
      if (catData) {
        catData.forEach(item => {
          if (!categoryMap[item.package_id]) categoryMap[item.package_id] = [];
          const name = item.category?.category_name || 'Unknown';
          categoryMap[item.package_id].push(name);
        });
      }
      setPackageCategories(categoryMap);

    } catch (error) {
      console.error('Error fetching package associations:', error);
      setPackageEquipment({});
      setPackageCategories({});
      toast.error('Unable to load package associations.');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
        .select('equipment_id, included_quantity')
        .eq('package_id', packageId);
      if (equipError) throw equipError;

      const selectedCategories = catData.map(row => row.category_id);
      const selectedEquipment = equipData.map(row => row.equipment_id);
      const equipmentQuantities = {};
      equipData.forEach(row => {
        equipmentQuantities[row.equipment_id] = row.included_quantity;
      });

      return { selectedCategories, selectedEquipment, equipmentQuantities };
    } catch (error) {
      console.error('Error fetching associations for edit:', error);
      toast.error('Unable to load package details for editing.');
      return { selectedCategories: [], selectedEquipment: [], equipmentQuantities: {} };
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
    setFormData(prev => {
      const current = prev.selectedEquipment || [];
      const quantities = { ...prev.equipmentQuantities };
      if (current.includes(equipmentId)) {
        const newSelected = current.filter(id => id !== equipmentId);
        delete quantities[equipmentId];
        return { ...prev, selectedEquipment: newSelected, equipmentQuantities: quantities };
      } else {
        return {
          ...prev,
          selectedEquipment: [...current, equipmentId],
          equipmentQuantities: { ...quantities, [equipmentId]: quantity },
        };
      }
    });
  };

  const handleEquipmentQuantityChange = (equipmentId, quantity) => {
    setFormData(prev => ({
      ...prev,
      equipmentQuantities: { ...prev.equipmentQuantities, [equipmentId]: parseInt(quantity) || 1 },
    }));
  };

  const handleOpenModal = async (type, item = null) => {
    setModalType(type);
    setEditingId(item ? (type === 'Package' ? item.package_id : item.menu_item_id) : null);

    if (item && type === 'Package') {
      const { selectedCategories, selectedEquipment, equipmentQuantities } =
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
      });
    } else if (item && type === 'Menu Item') {
      setFormData({
        title: item.menu_name || '',
        price: item.menu_price?.toString() || '',
        minPax: '',
        categoryId: item.category_id || '',
        description: '',
        imageFile: null,
        selectedCategories: [],
        selectedEquipment: [],
        equipmentQuantities: {},
      });
    } else {
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
      });
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
    });
    setIsSubmitting(false);
  };

  // --- SUBMIT ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const cleanPrice = parseFloat(formData.price) || 0;
      let uploadedImageUrl = null;

      if (formData.imageFile) {
        try {
          const fileExt = formData.imageFile.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `${modalType === 'Package' ? 'packages' : 'menu'}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('images')
            .upload(filePath, formData.imageFile);

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
          pkg_name: formData.title,
          pkg_description: formData.description || 'No description provided.',
          pkg_price: cleanPrice,
          minimum_pax: parseInt(formData.minPax) || 0,
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

        // Update equipment
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
          }));
          const { error: insertEquipError } = await supabase
            .from('package_equipment')
            .insert(inserts);
          if (insertEquipError) throw insertEquipError;
        }

        toast.success(editingId ? 'Package updated successfully!' : 'Package created successfully!');
        await fetchData();

      } else {
        const menuData = {
          menu_name: formData.title,
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
    if (!confirm(`Delete this ${type}? This action cannot be undone.`)) return;

    try {
      if (type === 'Package') {
        const { count, error: countError } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .eq('package_id', id);
        if (countError) throw countError;
        if (count > 0) {
          toast.error(`Cannot delete this package because it is used in ${count} booking(s). Please remove the bookings first.`);
          return;
        }

        await supabase.from('package_category').delete().eq('package_id', id);
        await supabase.from('package_equipment').delete().eq('package_id', id);
        const { error } = await supabase.from('package').delete().eq('package_id', id);
        if (error) throw error;
        toast.success('Package deleted.');
      } else {
        const { count, error: countError } = await supabase
          .from('package_menu')
          .select('*', { count: 'exact', head: true })
          .eq('menu_item_id', id);
        if (countError) throw countError;
        if (count > 0) {
          toast.error(`Cannot delete this menu item because it is included in ${count} package(s). Please remove it from packages first.`);
          return;
        }

        const { error } = await supabase
          .from('menu_item')
          .delete()
          .eq('menu_item_id', id);
        if (error) throw error;
        toast.success('Menu item deleted.');
      }
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete item.');
    }
  };

  // --- TOGGLE ARCHIVE ---
  const toggleArchive = async (id, type) => {
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
      fetchData();
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
      const data = {
        category_name: categoryForm.category_name,
        category_description: categoryForm.category_description || '',
      };
      if (categoryForm.category_id) {
        const { error } = await supabase
          .from('category')
          .update(data)
          .eq('category_id', categoryForm.category_id);
        if (error) throw error;
        toast.success('Category updated!');
      } else {
        const { error } = await supabase
          .from('category')
          .insert([data]);
        if (error) throw error;
        toast.success('Category added!');
      }
      setIsCategoryModalOpen(false);
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to save category.');
    } finally {
      setIsCategorySubmitting(false);
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (!confirm('Delete this category? It will be removed from all packages.')) return;
    try {
      const { error } = await supabase
        .from('category')
        .delete()
        .eq('category_id', categoryId);
      if (error) throw error;
      toast.success('Category deleted.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete category.');
    }
  };

  // --- FILTER LOGIC ---
  const getDisplayedPackages = () => {
    if (activeTab === 'Archived') {
      return packages.filter(p => p.pkg_availability === 'Archived');
    }
    if (activeTab === 'Catering Packages') {
      return packages.filter(p => p.pkg_availability !== 'Archived');
    }
    return packages;
  };

  const getDisplayedMenuItems = () => {
    if (activeTab === 'Archived') {
      return menuItems.filter(m => m.menu_availability === 'Archived');
    }
    if (activeTab === 'Menu Items') {
      return menuItems.filter(m => m.menu_availability !== 'Archived');
    }
    if (activeTab === 'All') {
      return menuItems;
    }
    return [];
  };

  const displayedPackages = getDisplayedPackages();
  const displayedMenuItems = getDisplayedMenuItems();
  const showPackages = activeTab === 'All' || activeTab === 'Catering Packages' || activeTab === 'Archived';
  const showMenuItems = activeTab === 'All' || activeTab === 'Menu Items' || (activeTab === 'Archived' && displayedMenuItems.length > 0);

  // --- RENDER HELPER for images ---
  const renderImage = (src, alt, className) => {
    if (!src) {
      return (
        <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}>
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="sr-only">No Image</span>
        </div>
      );
    }

    return (
      <img
        src={src}
        alt={alt}
        className={className}
        onError={(e) => {
          e.target.style.display = 'none';
          const parent = e.target.parentNode;
          const fallback = document.createElement('div');
          fallback.className = `${className} flex items-center justify-center bg-slate-100 text-slate-400`;
          fallback.innerHTML = `
            <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="sr-only">Image failed to load</span>
          `;
          parent.appendChild(fallback);
          console.warn(`Image failed to load: ${src}`);
        }}
      />
    );
  };

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packages & Menu</h1>
          <p className="text-sm text-slate-500">Manage packages, menu items, categories, and equipment templates</p>
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

      {/* TABS */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {['All', 'Catering Packages', 'Menu Items', 'Archived'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
              {displayedPackages.length === 0 && (
                <p className="text-sm text-slate-500 italic">No packages found.</p>
              )}
              {displayedPackages.map((pkg) => {
                const equipmentNames = packageEquipment[pkg.package_id] || [];
                const categoryNames = packageCategories[pkg.package_id] || [];

                return (
                  <div key={pkg.package_id} className="flex flex-col md:flex-row bg-[#f8fafa] border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full md:w-72 h-48 md:h-auto bg-slate-200 shrink-0 relative">
                      {renderImage(pkg.pkg_image, pkg.pkg_name, "w-full h-full object-cover")}
                    </div>
                    <div className="p-6 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex flex-wrap justify-between items-start gap-4 mb-2">
                          <h3 className="text-xl font-bold text-slate-900">{pkg.pkg_name}</h3>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleOpenModal('Package', pkg)}
                              className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-50 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => toggleArchive(pkg.package_id, 'package')}
                              className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-50 transition-colors"
                            >
                              {pkg.pkg_availability === 'Archived' ? 'Unarchive' : 'Archive'}
                            </button>
                            <button
                              onClick={() => handleDelete(pkg.package_id, 'Package')}
                              className="px-3 py-1 bg-red-50 border border-red-200 text-red-600 text-xs font-semibold rounded-md hover:bg-red-100 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 mb-3 max-w-2xl">{pkg.pkg_description}</p>

                        {/* Categories */}
                        {categoryNames.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 mb-1.5">Included Categories:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {categoryNames.map((name, index) => (
                                <span
                                  key={index}
                                  className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Equipment */}
                        {equipmentNames.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-slate-500 mb-1.5">Included Equipment:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {equipmentNames.map((name, index) => (
                                <span
                                  key={index}
                                  className="px-2.5 py-0.5 bg-[#EAF3F2] text-slate-700 text-xs rounded-full border border-[#CBDEDD]"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-8">
                          <div>
                            <p className="text-xs text-slate-500 mb-0.5">Price</p>
                            <p className="font-bold text-slate-900">₱{Number(pkg.pkg_price).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-0.5">Min pax.</p>
                            <p className="font-bold text-slate-900">{pkg.minimum_pax}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Menu Items */}
          {showMenuItems && (
            <div className={`${activeTab === 'Archived' && displayedPackages.length > 0 ? 'border-t pt-8' : ''}`}>
              {(activeTab === 'All' || activeTab === 'Archived') && (
                <h3 className="text-lg font-bold text-slate-900 mb-4 border-b pb-2">
                  {activeTab === 'Archived' ? 'Archived Menu Items' : 'Individual Menu Items'}
                </h3>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {displayedMenuItems.map((item) => {
                  const category = categories.find(c => c.category_id === item.category_id);
                  return (
                    <div key={item.menu_item_id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                      <div>
                        <div className="w-full h-32 bg-slate-100 rounded-lg mb-3 flex items-center justify-center text-slate-300 overflow-hidden">
                          {renderImage(item.menu_image, item.menu_name, "w-full h-full object-cover")}
                        </div>
                        <p className="text-xs font-bold text-[#008A45] mb-1">{category?.category_name || 'Uncategorized'}</p>
                        <h4 className="font-bold text-slate-900">{item.menu_name}</h4>
                        <p className="font-semibold text-slate-700 mt-2">₱{Number(item.menu_price).toLocaleString()}</p>
                      </div>
                      <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
                        <button
                          onClick={() => handleOpenModal('Menu Item', item)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          Edit
                        </button>
                        <div className="flex gap-3">
                          <button
                            onClick={() => toggleArchive(item.menu_item_id, 'menu')}
                            className="text-xs font-semibold text-slate-500 hover:text-[#008A45] transition-colors"
                          >
                            {item.menu_availability === 'Archived' ? 'Unarchive' : 'Archive'}
                          </button>
                          <button
                            onClick={() => handleDelete(item.menu_item_id, 'Menu Item')}
                            className="text-xs font-semibold text-red-400 hover:text-red-600 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== MODAL ========== */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Edit Item' : 'Add New Item'}
              </h2>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 transition-colors" disabled={isSubmitting}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto">
              <form id="item-form" onSubmit={handleSubmit} className="space-y-6">
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
                        onChange={() => { setModalType('Package'); setFormData({ title: '', price: '', minPax: '', categoryId: '', description: '', imageFile: null, selectedCategories: [], selectedEquipment: [], equipmentQuantities: {} }); }}
                        className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                      <span className="font-medium text-sm">Package</span>
                    </label>
                    <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg transition-colors
                      ${modalType === 'Menu Item' ? 'bg-[#EAF3F2] border-[#008A45] text-slate-900' : 'border-slate-200 text-slate-600'}
                      ${editingId || isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}>
                      <input type="radio" name="itemType" value="Menu Item" checked={modalType === 'Menu Item'}
                        disabled={!!editingId || isSubmitting}
                        onChange={() => { setModalType('Menu Item'); setFormData({ title: '', price: '', minPax: '', categoryId: '', description: '', imageFile: null, selectedCategories: [], selectedEquipment: [], equipmentQuantities: {} }); }}
                        className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]" />
                      <span className="font-medium text-sm">Menu Item</span>
                    </label>
                  </div>
                </div>

                {/* Package Fields */}
                {modalType === 'Package' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1">Package Title</label>
                        <input type="text" name="title" value={formData.title} onChange={handleInputChange}
                          placeholder="e.g. Buffet Tier 1"
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none"
                          required disabled={isSubmitting} />
                      </div>
                      <div className="col-span-2 sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1">Min Pax.</label>
                        <input type="number" name="minPax" value={formData.minPax} onChange={handleInputChange}
                          placeholder="e.g. 50"
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                          required disabled={isSubmitting} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Price</label>
                      <input type="number" name="price" value={formData.price} onChange={handleInputChange}
                        placeholder="e.g. 150"
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                        required disabled={isSubmitting} />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                      <textarea name="description" value={formData.description} onChange={handleInputChange}
                        placeholder="Describe the package..." rows="2"
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                        disabled={isSubmitting} />
                    </div>

                    {/* Categories Selection */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Included Categories</label>
                      <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                        {categories.length === 0 ? (
                          <p className="text-sm text-slate-500">No categories available. Please add one.</p>
                        ) : (
                          categories.map((cat) => (
                            <label key={cat.category_id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(formData.selectedCategories || []).includes(cat.category_id)}
                                onChange={() => handleCategorySelection(cat.category_id)}
                                disabled={isSubmitting}
                                className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]"
                              />
                              {cat.category_name}
                              {cat.category_description && (
                                <span className="text-xs text-slate-400">({cat.category_description})</span>
                              )}
                            </label>
                          ))
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Customers can choose one menu item from each selected category.</p>
                    </div>

                    {/* Equipment Selection */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Included Equipment (template)</label>
                      <p className="text-xs text-slate-400 mb-2">Equipment will be reserved when a booking is confirmed, not now.</p>
                      <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                        {equipment.length === 0 ? (
                          <p className="text-sm text-slate-500">No equipment available.</p>
                        ) : (
                          equipment.map((eq) => {
                            const isSelected = (formData.selectedEquipment || []).includes(eq.equipment_id);
                            return (
                              <div key={eq.equipment_id} className="flex items-center gap-3 text-sm">
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleEquipmentSelection(eq.equipment_id, 1)}
                                    disabled={isSubmitting}
                                    className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]"
                                  />
                                  {eq.eqm_name} (total stock: {eq.quantity_available})
                                </label>
                                {isSelected && (
                                  <div className="flex items-center gap-1">
                                    <label className="text-xs text-slate-600">Qty:</label>
                                    <input
                                      type="number"
                                      min="1"
                                      value={formData.equipmentQuantities?.[eq.equipment_id] || 1}
                                      onChange={(e) => handleEquipmentQuantityChange(eq.equipment_id, e.target.value)}
                                      className="w-16 border border-slate-300 rounded p-1 text-sm"
                                      disabled={isSubmitting}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Menu Item Fields */}
                {modalType === 'Menu Item' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1">Menu Title</label>
                        <input type="text" name="title" value={formData.title} onChange={handleInputChange}
                          placeholder="e.g. Shrimp Dish"
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                          required disabled={isSubmitting} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Price</label>
                        <input type="number" name="price" value={formData.price} onChange={handleInputChange}
                          placeholder="e.g. 150"
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                          required disabled={isSubmitting} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                      <select name="categoryId" value={formData.categoryId} onChange={handleInputChange}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45] outline-none bg-white"
                        required disabled={isSubmitting}>
                        <option value="">Select Category</option>
                        {categories.map(cat => (
                          <option key={cat.category_id} value={cat.category_id}>
                            {cat.category_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Image Upload */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Upload Image</label>
                  <label className={`border-2 border-dashed border-slate-300 rounded-lg h-32 flex flex-col items-center justify-center text-slate-400 bg-slate-50 transition-colors relative overflow-hidden ${isSubmitting ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:bg-slate-100'}`}>
                    <input type="file" name="imageFile" accept="image/*" onChange={handleInputChange}
                      disabled={isSubmitting} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait" />
                    {formData.imageFile ? (
                      <span className="text-sm font-medium text-[#008A45]">{formData.imageFile.name}</span>
                    ) : (
                      <>
                        <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-sm font-medium">Click to upload or update</span>
                      </>
                    )}
                  </label>
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 sticky bottom-0">
              <button type="button" onClick={handleCloseModal} disabled={isSubmitting}
                className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" form="item-form" disabled={isSubmitting}
                className="px-5 py-2.5 text-sm font-bold text-white bg-[#008A45] rounded-lg hover:bg-[#007038] transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2">
                {isSubmitting && <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>}
                {isSubmitting ? 'Saving...' : (editingId ? 'Save Changes' : `Create ${modalType}`)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CATEGORY MANAGEMENT MODAL */}
      {isCategoryModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <h2 className="text-lg font-bold text-slate-900">Manage Categories</h2>
              <button onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.category_id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50">
                    <div>
                      <p className="font-bold text-slate-900">{cat.category_name}</p>
                      {cat.category_description && <p className="text-xs text-slate-500">{cat.category_description}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setIsCategoryModalOpen(false); handleOpenCategoryModal(cat); }}
                        className="text-slate-500 hover:text-slate-700 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(cat.category_id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {categories.length === 0 && <p className="text-sm text-slate-500 italic">No categories yet.</p>}
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50">
              <form onSubmit={handleCategorySubmit} className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category Name</label>
                  <input
                    type="text"
                    name="category_name"
                    value={categoryForm.category_name}
                    onChange={handleCategoryFormChange}
                    placeholder="e.g. Seafood"
                    className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                    required
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    name="category_description"
                    value={categoryForm.category_description}
                    onChange={handleCategoryFormChange}
                    placeholder="e.g. All seafood dishes"
                    className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isCategorySubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {isCategorySubmitting ? 'Saving...' : (categoryForm.category_id ? 'Update' : 'Add')}
                </button>
                {categoryForm.category_id && (
                  <button
                    type="button"
                    onClick={() => setCategoryForm({ category_id: null, category_name: '', category_description: '' })}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}