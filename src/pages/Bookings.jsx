// src/pages/Bookings.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Check, Edit, Trash2, ChevronLeft, ChevronRight, Filter, X, RefreshCw, RotateCcw } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function Bookings() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // --- Filter state ---
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    customerId: '',
    packageId: '',
    venue: '',
    status: '',
  });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  // Modal states for booking create/edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    customer_id: '',
    package_id: '',
    booking_type: 'Package',
    event_datetime: '',
    venue: '',
    pax_count: '',
    motif_color: '',
    notes: '',
    total_amount: '',
    delivery_fee: '0',
    menu_selections: {},
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [packageCategories, setPackageCategories] = useState([]);
  const [categoryMenuItems, setCategoryMenuItems] = useState({});

  // Approval modal state
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalBooking, setApprovalBooking] = useState(null);
  const [approvalData, setApprovalData] = useState({
    extraPax: 0,
    additionalFee: 0,
    extraDeliveryFee: 0,
    newTotal: 0,
    baseTotal: 0,
  });

  // Helper: log technical error and show user-friendly toast
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Auto-calculate total amount based on pricing type ---
  useEffect(() => {
    if (formData.package_id && formData.pax_count) {
      const selectedPkg = packages.find(p => p.package_id === formData.package_id);
      if (selectedPkg) {
        const pax = parseInt(formData.pax_count) || 0;
        const deliveryFee = parseFloat(formData.delivery_fee) || 0;
        let baseTotal = 0;

        if (selectedPkg.pricing_type === 'per_pax') {
          // Per Pax: price × number of guests
          const pkgPrice = selectedPkg.pkg_price || 0;
          baseTotal = pkgPrice * pax;
        } else {
          // Fixed Price: flat rate
          baseTotal = selectedPkg.pkg_price || 0;
          
          // If pax exceeds max_pax, charge extra
          if (selectedPkg.max_pax && pax > selectedPkg.max_pax) {
            const extraPax = pax - selectedPkg.max_pax;
            const extraPrice = selectedPkg.extra_pax_price || 0;
            baseTotal += extraPax * extraPrice;
          }
        }

        const total = baseTotal + deliveryFee;
        setFormData(prev => ({
          ...prev,
          total_amount: total.toFixed(2),
        }));
      }
    }
  }, [formData.package_id, formData.pax_count, formData.delivery_fee, packages]);

  // --- Allocate equipment (helper) ---
  const allocateEquipmentForBooking = async (bookingId, packageId, paxCount) => {
    try {
      const { data: equipTemplate, error: templateError } = await supabase
        .from('package_equipment')
        .select(`
          equipment_id,
          included_quantity,
          per_pax,
          equipment:equipment_id (eqm_name, quantity_available)
        `)
        .eq('package_id', packageId);

      if (templateError) throw templateError;
      if (!equipTemplate || equipTemplate.length === 0) {
        console.log('No equipment template found for this package.');
        return;
      }

      const allocations = [];
      for (const item of equipTemplate) {
        let quantity;
        if (item.per_pax) {
          const raw = item.included_quantity * (paxCount || 0);
          quantity = Math.max(1, Math.ceil(raw));
        } else {
          quantity = item.included_quantity || 1;
        }
        const available = item.equipment?.quantity_available || 0;
        if (quantity > available) {
          throw new Error(
            `Not enough ${item.equipment?.eqm_name || 'equipment'}. Needed ${quantity}, only ${available} available.`
          );
        }
        allocations.push({
          booking_id: bookingId,
          equipment_id: item.equipment_id,
          quantity: quantity,
          notes: `Auto-allocated from package (${paxCount} pax)`,
          returned: false,
          assigned_at: new Date().toISOString(),
        });
      }

      const { error: insertError } = await supabase
        .from('booking_equipment')
        .insert(allocations);
      if (insertError) throw insertError;

      for (const alloc of allocations) {
        const { data: equipData, error: fetchError } = await supabase
          .from('equipment')
          .select('quantity_available')
          .eq('equipment_id', alloc.equipment_id)
          .single();
        if (fetchError) throw fetchError;

        const newQuantity = equipData.quantity_available - alloc.quantity;
        const { error: updateError } = await supabase
          .from('equipment')
          .update({ quantity_available: newQuantity })
          .eq('equipment_id', alloc.equipment_id);
        if (updateError) throw updateError;
      }

      console.log(`✅ Allocated ${allocations.length} equipment items for booking ${bookingId}`);
    } catch (error) {
      console.error('Error allocating equipment:', error);
      throw error;
    }
  };

  // --- Fetch data ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('booking')
        .select('*')
        .eq('booking_type', 'Package')
        .order('event_datetime', { ascending: false });

      if (bookingsError) throw bookingsError;

      if (bookingsData && bookingsData.length > 0) {
        const customerIds = bookingsData.map(b => b.customer_id).filter(id => id);
        const packageIds = bookingsData.map(b => b.package_id).filter(id => id);

        let customersMap = {};
        let packagesMap = {};

        if (customerIds.length > 0) {
          const { data: customersData, error: customersError } = await supabase
            .from('customer')
            .select('customer_id, first_name, last_name, contact_no')
            .in('customer_id', customerIds);
          if (customersError) throw customersError;
          customersMap = Object.fromEntries(customersData.map(c => [c.customer_id, c]));
        }

        if (packageIds.length > 0) {
          const { data: packagesData, error: packagesError } = await supabase
            .from('package')
            .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price')
            .in('package_id', packageIds);
          if (packagesError) throw packagesError;
          packagesMap = Object.fromEntries(packagesData.map(p => [p.package_id, p]));
        }

        const enriched = bookingsData.map(booking => ({
          ...booking,
          customer: customersMap[booking.customer_id] || null,
          package: packagesMap[booking.package_id] || null,
        }));
        setBookings(enriched);
      } else {
        setBookings([]);
      }

      const { data: customersList, error: customersListError } = await supabase
        .from('customer')
        .select('customer_id, first_name, last_name')
        .eq('account_status', 'Active')
        .order('first_name');
      if (customersListError) throw customersListError;
      setCustomers(customersList || []);

      const { data: packagesList, error: packagesListError } = await supabase
        .from('package')
        .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price')
        .eq('pkg_availability', 'Available')
        .order('pkg_name');
      if (packagesListError) throw packagesListError;
      setPackages(packagesList || []);

    } catch (error) {
      handleError(error, 'Unable to load bookings. Please refresh the page.');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Fetch package categories and menu items when package changes ---
  useEffect(() => {
    if (!formData.package_id) {
      setPackageCategories([]);
      setCategoryMenuItems({});
      return;
    }

    const fetchPackageDetails = async () => {
      try {
        const { data: catData, error: catError } = await supabase
          .from('package_category')
          .select(`
            category_id,
            category:category_id (category_id, category_name)
          `)
          .eq('package_id', formData.package_id);
        if (catError) throw catError;

        const categories = catData.map(item => ({
          category_id: item.category.category_id,
          category_name: item.category.category_name,
        }));
        setPackageCategories(categories);

        const menuItemsMap = {};
        for (const cat of categories) {
          const { data: menuData, error: menuError } = await supabase
            .from('menu_item')
            .select('menu_item_id, menu_name')
            .eq('category_id', cat.category_id)
            .eq('menu_availability', 'Available')
            .order('menu_name');
          if (menuError) throw menuError;
          menuItemsMap[cat.category_id] = menuData || [];
        }
        setCategoryMenuItems(menuItemsMap);
      } catch (error) {
        console.error('Error fetching package details:', error);
        toast.error('Unable to load menu items for this package.');
      }
    };

    fetchPackageDetails();
  }, [formData.package_id]);

  // --- Modal handlers ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleMenuSelectionChange = (categoryId, menuItemId) => {
    setFormData(prev => ({
      ...prev,
      menu_selections: {
        ...prev.menu_selections,
        [categoryId]: menuItemId,
      },
    }));
  };

  const openNewBookingModal = () => {
    setEditingId(null);
    setFormData({
      customer_id: '',
      package_id: '',
      booking_type: 'Package',
      event_datetime: '',
      venue: '',
      pax_count: '',
      motif_color: '',
      notes: '',
      total_amount: '',
      delivery_fee: '0',
      menu_selections: {},
    });
    setPackageCategories([]);
    setCategoryMenuItems({});
    setIsModalOpen(true);
  };

  const openEditModal = (booking) => {
    setEditingId(booking.booking_id);
    setFormData({
      customer_id: booking.customer_id,
      package_id: booking.package_id || '',
      booking_type: booking.booking_type,
      event_datetime: booking.event_datetime ? new Date(booking.event_datetime).toISOString().slice(0, 16) : '',
      venue: booking.venue || '',
      pax_count: booking.pax_count?.toString() || '',
      motif_color: booking.motif_color || '',
      notes: booking.notes || '',
      total_amount: booking.total_amount?.toString() || '',
      delivery_fee: booking.delivery_fee?.toString() || '0',
      menu_selections: booking.menu_selections || {},
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({
      customer_id: '',
      package_id: '',
      booking_type: 'Package',
      event_datetime: '',
      venue: '',
      pax_count: '',
      motif_color: '',
      notes: '',
      total_amount: '',
      delivery_fee: '0',
      menu_selections: {},
    });
    setPackageCategories([]);
    setCategoryMenuItems({});
    setIsSubmitting(false);
  };

  // --- Filter Modal handlers ---
  const openFilterModal = () => {
    setIsFilterModalOpen(true);
  };

  const closeFilterModal = () => {
    setIsFilterModalOpen(false);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const applyFilters = () => {
    setIsFilterModalOpen(false);
  };

  const clearFilters = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      customerId: '',
      packageId: '',
      venue: '',
      status: '',
    });
  };

  // --- CRUD Operations ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!formData.package_id) {
      toast.error('Please select a package for this booking.');
      setIsSubmitting(false);
      return;
    }

    const requiredCategories = packageCategories.map(c => c.category_id);
    const selectedCategories = Object.keys(formData.menu_selections);
    const missing = requiredCategories.filter(c => !selectedCategories.includes(c));
    if (missing.length > 0) {
      toast.error('Please select a menu item for each category.');
      setIsSubmitting(false);
      return;
    }

    try {
      const payload = {
        customer_id: formData.customer_id,
        package_id: formData.package_id,
        booking_type: 'Package',
        event_datetime: formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null,
        venue: formData.venue,
        pax_count: parseInt(formData.pax_count) || 0,
        motif_color: formData.motif_color || null,
        notes: formData.notes || null,
        total_amount: parseFloat(formData.total_amount) || 0,
        delivery_fee: parseFloat(formData.delivery_fee) || 0,
        booking_status: editingId ? undefined : 'Pending',
        menu_selections: formData.menu_selections,
        book_datetime: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from('booking')
          .update(payload)
          .eq('booking_id', editingId);
        if (error) throw error;
        toast.success('Booking updated successfully!');
      } else {
        const { data: newBooking, error } = await supabase
          .from('booking')
          .insert([payload])
          .select();
        if (error) throw error;
        const bookingId = newBooking[0].booking_id;

        const { error: paymentError } = await supabase
          .from('payment')
          .insert([{
            booking_id: bookingId,
            amount_paid: 0,
            pay_installment: 1,
            pay_method: 'Pending',
            pay_status: 'Pending',
            pay_datetime: new Date().toISOString(),
            pay_proof: 'placeholder.png',
          }]);
        if (paymentError) throw paymentError;

        toast.success('Booking created successfully!');
      }

      closeModal();
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to save booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Approval Modal Logic ---
  const openApprovalModal = (booking) => {
    setApprovalBooking(booking);
    const baseTotal = booking.total_amount || 0;
    setApprovalData({
      extraPax: 0,
      additionalFee: 0,
      extraDeliveryFee: 0,
      newTotal: baseTotal,
      baseTotal: baseTotal,
    });
    setIsApprovalModalOpen(true);
  };

  const handleApprovalInputChange = (e) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value) || 0;
    setApprovalData(prev => {
      const updated = { ...prev, [name]: numValue };
      const pkgPrice = approvalBooking?.package?.pkg_price || 0;
      const extraPaxCost = updated.extraPax * pkgPrice;
      const newTotal = updated.baseTotal + extraPaxCost + updated.additionalFee + updated.extraDeliveryFee;
      return { ...updated, newTotal };
    });
  };

  const handleFinalizeApproval = async () => {
    if (!approvalBooking) return;
    setIsSubmitting(true);
    try {
      const { data: payments, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', approvalBooking.booking_id);

      if (paymentsError) throw paymentsError;

      const totalPaid = payments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const required = approvalData.newTotal * 0.5;

      if (totalPaid < required) {
        toast.error(
          `Cannot approve. Total paid (₱${totalPaid.toFixed(2)}) is less than 50% of the total (₱${required.toFixed(2)}). Please record more payments.`,
          { duration: 6000 }
        );
        setIsSubmitting(false);
        return;
      }

      const newPax = approvalBooking.pax_count + approvalData.extraPax;
      const newTotal = approvalData.newTotal;
      const newDeliveryFee = parseFloat(approvalBooking.delivery_fee || 0) + approvalData.extraDeliveryFee;

      const { error: updateError } = await supabase
        .from('booking')
        .update({
          booking_status: 'Approved',
          pax_count: newPax,
          total_amount: newTotal,
          delivery_fee: newDeliveryFee,
        })
        .eq('booking_id', approvalBooking.booking_id);

      if (updateError) throw updateError;

      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Downpayment' })
        .eq('booking_id', approvalBooking.booking_id);

      if (updatePaymentsError) throw updatePaymentsError;

      if (approvalBooking.package_id) {
        try {
          await allocateEquipmentForBooking(approvalBooking.booking_id, approvalBooking.package_id, newPax);
        } catch (allocError) {
          console.error('Equipment allocation failed:', allocError);
          toast.error('Booking approved, but equipment allocation had errors. Please check inventory manually.');
        }
      }

      setIsApprovalModalOpen(false);
      fetchData();
      toast.success('Booking approved and payments set to Downpayment.');
    } catch (error) {
      handleError(error, 'Failed to approve booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Mark as Completed ---
  const handleMarkCompleted = async (id) => {
    const confirmed = await showConfirm({
      title: 'Mark as Completed?',
      message: 'Are you sure you want to mark this booking as completed?',
      confirmLabel: 'Complete',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Completed' })
        .eq('booking_id', id);
      if (error) throw error;

      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Fully Paid' })
        .eq('booking_id', id);
      if (updatePaymentsError) throw updatePaymentsError;

      toast.success('Booking marked completed and payments set to Fully Paid.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to update status.');
    }
  };

  // --- Reject ---
  const handleReject = async (id) => {
    const confirmed = await showConfirm({
      title: 'Reject Booking?',
      message: 'Are you sure you want to reject this booking? This will cancel it and cannot be undone.',
      confirmLabel: 'Reject',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Rejected' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Booking rejected.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to reject booking.');
    }
  };

  // --- Delete ---
  const handleDelete = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: 'Are you sure you want to permanently delete this booking? This action cannot be undone. All associated payments will also be deleted.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;

      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      
      toast.success('Booking deleted.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete booking.');
    }
  };

  // --- Filter logic ---
  const tabs = ['All', 'Pending', 'Approved', 'Completed', 'Rejected'];
  
  const filtered = bookings.filter(b => {
    if (activeTab !== 'All' && b.booking_status !== activeTab) return false;
    
    if (searchTerm) {
      const name = `${b.customer?.first_name || ''} ${b.customer?.last_name || ''}`.toLowerCase();
      const id = b.booking_id.toLowerCase();
      const search = searchTerm.toLowerCase();
      if (!name.includes(search) && !id.includes(search)) return false;
    }

    if (filters.dateFrom && b.event_datetime) {
      const eventDate = new Date(b.event_datetime);
      const fromDate = new Date(filters.dateFrom);
      fromDate.setHours(0,0,0,0);
      if (eventDate < fromDate) return false;
    }
    if (filters.dateTo && b.event_datetime) {
      const eventDate = new Date(b.event_datetime);
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23,59,59,999);
      if (eventDate > toDate) return false;
    }

    if (filters.customerId && b.customer_id !== filters.customerId) return false;
    if (filters.packageId && b.package_id !== filters.packageId) return false;

    if (filters.venue && b.venue) {
      const venueLower = b.venue.toLowerCase();
      const searchVenue = filters.venue.toLowerCase();
      if (!venueLower.includes(searchVenue)) return false;
    }

    return true;
  });

  const hasActiveFilters = filters.dateFrom || filters.dateTo || filters.customerId || filters.packageId || filters.venue;

  const getStatusBadge = (status) => {
    const map = {
      Pending: 'bg-amber-50 border-amber-200 text-amber-700',
      Approved: 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800',
      Completed: 'bg-blue-50 border-blue-200 text-blue-700',
      Rejected: 'bg-red-50 border-red-200 text-red-700',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-6 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
          <p className="text-sm text-slate-500">Manage all client catering reservations (package bookings only)</p>
        </div>
        <button
          onClick={openNewBookingModal}
          className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm shadow-sm"
        >
          + New Booking
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-6 border-b border-slate-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 shrink-0 ${
              activeTab === tab
                ? 'border-[#008A45] text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by client name or booking ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-300 rounded-lg py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] bg-white"
          />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        </div>
        <button
          onClick={openFilterModal}
          className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 bg-white shadow-xs"
        >
          <Filter size={16} />
          Filter
          {hasActiveFilters && (
            <span className="ml-1 w-2 h-2 rounded-full bg-[#008A45] inline-block" />
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 bg-white shadow-xs"
          >
            <RotateCcw size={16} />
            Clear
          </button>
        )}
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-xs"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Venue</th>
                <th className="p-4 font-bold">Pax</th>
                <th className="p-4 font-bold">Package</th>
                <th className="p-4 font-bold">Amount</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400">Loading bookings...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-500 italic">No package bookings found.</td></tr>
              ) : (
                filtered.map((booking) => (
                  <tr key={booking.booking_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <p
                        onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                        className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-4 cursor-pointer hover:text-[#008A45]"
                      >
                        {booking.customer?.first_name} {booking.customer?.last_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {booking.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'No date'}
                      </p>
                    </td>
                    <td className="p-4 font-medium">{booking.venue || 'N/A'}</td>
                    <td className="p-4">{booking.pax_count || 0} pax</td>
                    <td className="p-4 font-medium">{booking.package?.pkg_name || 'N/A'}</td>
                    <td className="p-4 font-bold text-slate-900">
                      ₱{booking.total_amount?.toLocaleString() || '0'}
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusBadge(booking.booking_status)}`}>
                        {booking.booking_status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {booking.booking_status === 'Pending' && (
                          <>
                            <button
                              onClick={() => openApprovalModal(booking)}
                              className="bg-[#C1DEDC] border border-[#a8cfcc] text-slate-800 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-[#b8dad7] transition-colors"
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button
                              onClick={() => handleReject(booking.booking_id)}
                              className="bg-red-100 border border-red-200 text-red-700 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-200 transition-colors"
                            >
                              <X size={14} /> Reject
                            </button>
                          </>
                        )}
                        {booking.booking_status === 'Approved' && (
                          <button
                            onClick={() => handleMarkCompleted(booking.booking_id)}
                            className="bg-blue-100 border border-blue-200 text-blue-700 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors"
                          >
                            <Check size={14} /> Mark Completed
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                          className="bg-white border border-slate-300 text-slate-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => openEditModal(booking)}
                          className="text-slate-400 hover:text-slate-700 transition-colors p-1"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(booking.booking_id)}
                          className="text-red-400 hover:text-red-600 transition-colors p-1"
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
        <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-white text-sm text-slate-600">
          <span>Showing {filtered.length} of {bookings.length} bookings</span>
          <div className="flex items-center gap-1">
            <button className="p-1 text-slate-400 hover:text-slate-800 transition-colors"><ChevronLeft size={16} /></button>
            <button className="w-7 h-7 flex items-center justify-center rounded bg-[#008A45] text-white font-bold">1</button>
            <button className="p-1 text-slate-400 hover:text-slate-800 transition-colors"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* NEW/EDIT BOOKING MODAL */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Booking' : 'New Booking'}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Customer */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <select
                  name="customer_id"
                  value={formData.customer_id}
                  onChange={handleInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.first_name} {c.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Package */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Package *</label>
                <select
                  name="package_id"
                  value={formData.package_id}
                  onChange={handleInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Package</option>
                  {packages.map(p => (
                    <option key={p.package_id} value={p.package_id}>
                      {p.pkg_name} {p.pricing_type === 'fixed' ? '(Fixed)' : '(Per Pax)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Menu Selections */}
              {packageCategories.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">Menu Selections</label>
                  <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                    {packageCategories.map(cat => {
                      const items = categoryMenuItems[cat.category_id] || [];
                      const selected = formData.menu_selections[cat.category_id] || '';
                      return (
                        <div key={cat.category_id} className="flex items-center gap-4">
                          <span className="w-32 text-sm font-bold text-slate-700">{cat.category_name}</span>
                          <select
                            value={selected}
                            onChange={(e) => handleMenuSelectionChange(cat.category_id, e.target.value)}
                            className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                            required
                          >
                            <option value="">Select Menu Item</option>
                            {items.map(item => (
                              <option key={item.menu_item_id} value={item.menu_item_id}>
                                {item.menu_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Choose one menu item per category.</p>
                </div>
              )}

              {/* Event Date/Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time</label>
                <input
                  type="datetime-local"
                  name="event_datetime"
                  value={formData.event_datetime}
                  onChange={handleInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                />
              </div>

              {/* Venue */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue</label>
                <input
                  type="text"
                  name="venue"
                  value={formData.venue}
                  onChange={handleInputChange}
                  placeholder="e.g. Grand Pavilion"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                />
              </div>

              {/* Pax, Color, Delivery Fee, Total Amount */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pax Count</label>
                  <input
                    type="number"
                    name="pax_count"
                    value={formData.pax_count}
                    onChange={handleInputChange}
                    placeholder="e.g. 80"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motif Color</label>
                  <input
                    type="text"
                    name="motif_color"
                    value={formData.motif_color}
                    onChange={handleInputChange}
                    placeholder="e.g. Burgundy"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                  <input
                    type="number"
                    name="delivery_fee"
                    value={formData.delivery_fee}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (editable)</label>
                  <input
                    type="number"
                    name="total_amount"
                    value={formData.total_amount}
                    onChange={handleInputChange}
                    placeholder="Auto-calculated"
                    step="0.01"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                  <p className="text-xs text-slate-400 mt-1">Auto-calculated based on package pricing. You can adjust.</p>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows="2"
                  placeholder="Special instructions..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={closeModal} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* APPROVAL MODAL */}
      {isApprovalModalOpen && approvalBooking && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Booking – Adjust Fees</h2>
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-left">
              {/* Booking summary */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {approvalBooking.customer?.first_name} {approvalBooking.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Package:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.package?.pkg_name}</span>
                  <span className="font-medium text-slate-600">Current Pax:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.pax_count}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalBooking.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">* Adjust extra pax or add fees below.</p>
              </div>

              {/* Adjustment fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Pax (additional headcount)</label>
                  <input
                    type="number"
                    name="extraPax"
                    min="0"
                    value={approvalData.extraPax}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Each extra pax costs ₱{approvalBooking.package?.pkg_price || 0} (package price per pax).</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                  <input
                    type="number"
                    name="extraDeliveryFee"
                    min="0"
                    step="0.01"
                    value={approvalData.extraDeliveryFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons, extra services)</label>
                  <input
                    type="number"
                    name="additionalFee"
                    min="0"
                    step="0.01"
                    value={approvalData.additionalFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 2000"
                  />
                </div>
              </div>

              {/* New total display */}
              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Down payment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">* Down payment is required to secure the booking (non-refundable within 3 days of event).</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalizeApproval}
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* FILTER MODAL */}
      {isFilterModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Filter Bookings</h2>
              <button
                onClick={closeFilterModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Event Date From</label>
                  <input
                    type="date"
                    name="dateFrom"
                    value={filters.dateFrom}
                    onChange={handleFilterChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Event Date To</label>
                  <input
                    type="date"
                    name="dateTo"
                    value={filters.dateTo}
                    onChange={handleFilterChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                </div>
              </div>

              {/* Customer */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer</label>
                <select
                  name="customerId"
                  value={filters.customerId}
                  onChange={handleFilterChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                >
                  <option value="">All Customers</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.first_name} {c.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Package */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Package</label>
                <select
                  name="packageId"
                  value={filters.packageId}
                  onChange={handleFilterChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                >
                  <option value="">All Packages</option>
                  {packages.map(p => (
                    <option key={p.package_id} value={p.package_id}>
                      {p.pkg_name} {p.pricing_type === 'fixed' ? '(Fixed)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Venue */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue (contains)</label>
                <input
                  type="text"
                  name="venue"
                  value={filters.venue}
                  onChange={handleFilterChange}
                  placeholder="e.g. Grand Pavilion"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    clearFilters();
                    closeFilterModal();
                  }}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Clear Filters
                </button>
                <button
                  type="button"
                  onClick={applyFilters}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}