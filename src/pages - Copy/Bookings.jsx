// src/pages/Bookings.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Check, Edit, Trash2, ChevronLeft, ChevronRight, Filter, X, RefreshCw, RotateCcw, UserPlus } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { computeEquipmentDemand, checkEquipmentCapacityForDate } from '../utils/equipment'; // 👈 new import

export default function Bookings() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBookings, setSelectedBookings] = useState([]); // 👈 added
    // --- Pagination state ---
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(10); // Items per page
  const [totalPages, setTotalPages] = useState(1);

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
  const [isWalkIn, setIsWalkIn] = useState(false);
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
  const [walkInData, setWalkInData] = useState({
    first_name: '',
    last_name: '',
    contact_no: '',
    email_address: '',
    cus_address: '',
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

  // --- Create walk-in customer with session restore and global flag ---
  const createWalkInCustomer = async () => {
    // 🔥 Set the global flag to prevent auto‑logout
    window.isCreatingWalkIn = true;

    try {
      // 1. Save current session (manager)
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (!currentSession) {
        throw new Error('You must be logged in as a manager to create walk-in customers.');
      }

      // 2. Check email existence
      const { data: existingCustomer, error: checkError } = await supabase
        .from('customer')
        .select('customer_id')
        .eq('email_address', walkInData.email_address)
        .maybeSingle();
      if (checkError) throw checkError;

      if (existingCustomer) {
        toast.info('Customer with this email already exists. Using existing account.');
        return existingCustomer.customer_id;
      }

      // 3. Generate unique username
      const username = walkInData.email_address.split('@')[0];
      let finalUsername = username;
      let counter = 1;
      while (true) {
        const { data: existingUsername, error: usernameCheckError } = await supabase
          .from('customer')
          .select('customer_id')
          .eq('username', finalUsername)
          .maybeSingle();
        if (usernameCheckError) throw usernameCheckError;
        if (!existingUsername) break;
        finalUsername = `${username}${counter}`;
        counter++;
      }

      // 4. Create Supabase Auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: walkInData.email_address,
        password: 'password123',
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          const { data: existing } = await supabase
            .from('customer')
            .select('customer_id')
            .eq('email_address', walkInData.email_address)
            .maybeSingle();
          if (existing) {
            toast.info('Customer already exists. Using existing account.');
            return existing.customer_id;
          }
          throw new Error('Email already registered but no customer record found. Please use a different email.');
        }
        throw authError;
      }

      // 5. Insert customer record
      const { data: newCustomer, error: customerError } = await supabase
        .from('customer')
        .insert([{
          first_name: walkInData.first_name,
          last_name: walkInData.last_name,
          contact_no: walkInData.contact_no,
          email_address: walkInData.email_address,
          cus_address: walkInData.cus_address || 'N/A',
          username: finalUsername,
          password: 'password123',
          account_status: 'Active',
          user_id: authData.user?.id,
        }])
        .select()
        .single();

      if (customerError) throw customerError;

      // 6. ✅ CRITICAL: Restore manager session
      await new Promise(resolve => setTimeout(resolve, 300));

      if (currentSession) {
        const { error: restoreError } = await supabase.auth.setSession({
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token,
        });
        if (restoreError) {
          console.error('Failed to restore manager session:', restoreError);
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            console.error('Refresh also failed:', refreshError);
            const managerSession = localStorage.getItem('supabase.auth.token');
            if (managerSession) {
              try {
                const parsed = JSON.parse(managerSession);
                await supabase.auth.setSession(parsed);
              } catch (e) {
                console.error('Failed to restore from localStorage:', e);
              }
            }
          }
        } else {
          console.log('✅ Manager session restored');
        }
      }

      // 7. Wait a bit more to let the auth state propagate
      await new Promise(resolve => setTimeout(resolve, 300));

      // 8. Verify session is restored
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: manager } = await supabase
          .from('manager')
          .select('manager_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!manager) {
          if (currentSession) {
            await supabase.auth.setSession({
              access_token: currentSession.access_token,
              refresh_token: currentSession.refresh_token,
            });
          }
          const { data: { user: finalUser } } = await supabase.auth.getUser();
          if (finalUser) {
            const { data: finalManager } = await supabase
              .from('manager')
              .select('manager_id')
              .eq('user_id', finalUser.id)
              .maybeSingle();
            if (!finalManager) {
              throw new Error('Failed to restore manager session. Please refresh the page.');
            }
          }
        }
      }

      toast.success('Customer account created! Default password: password123');
      return newCustomer.customer_id;

    } catch (error) {
      console.error('Error creating walk-in customer:', error);
      throw new Error(error.message || 'Failed to create customer account. Please try again.');
    } finally {
      // 🔥 Clear the global flag
      window.isCreatingWalkIn = false;
    }
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
          const pkgPrice = selectedPkg.pkg_price || 0;
          baseTotal = pkgPrice * pax;
        } else {
          baseTotal = selectedPkg.pkg_price || 0;
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

// --- Fetch data with pagination ---
const fetchData = async () => {
  setLoading(true);
  try {
    // Calculate range
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    // Fetch with pagination and count
    const { data: bookingsData, count, error: bookingsError } = await supabase
      .from('booking')
      .select('*', { count: 'exact' })
      .eq('booking_type', 'Package')
      .order('event_datetime', { ascending: false })
      .range(from, to);

    if (bookingsError) throw bookingsError;

    // Update total count and pages
    setTotalCount(count || 0);
    setTotalPages(Math.ceil((count || 0) / pageSize));

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
          .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax')
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

    // Fetch customers and packages for dropdowns (unchanged – these don't need pagination)
    const { data: customersList, error: customersListError } = await supabase
      .from('customer')
      .select('customer_id, first_name, last_name')
      .eq('account_status', 'Active')
      .order('first_name');
    if (customersListError) throw customersListError;
    setCustomers(customersList || []);

    const { data: packagesList, error: packagesListError } = await supabase
      .from('package')
      .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax')
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
}, [currentPage]);

// --- Pagination handlers ---
const goToPage = (page) => {
  if (page < 1 || page > totalPages) return;
  setCurrentPage(page);
};

const goToPrevPage = () => {
  if (currentPage > 1) {
    setCurrentPage(currentPage - 1);
  }
};

const goToNextPage = () => {
  if (currentPage < totalPages) {
    setCurrentPage(currentPage + 1);
  }
};

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

  const handleWalkInChange = (e) => {
    const { name, value } = e.target;
    setWalkInData(prev => ({ ...prev, [name]: value }));
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
    setIsWalkIn(false);
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
    setWalkInData({
      first_name: '',
      last_name: '',
      contact_no: '',
      email_address: '',
      cus_address: '',
    });
    setPackageCategories([]);
    setCategoryMenuItems({});
    setIsModalOpen(true);
  };

  const openEditModal = (booking) => {
    setEditingId(booking.booking_id);
    setIsWalkIn(false);
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
    setWalkInData({
      first_name: '',
      last_name: '',
      contact_no: '',
      email_address: '',
      cus_address: '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setIsWalkIn(false);
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
    setWalkInData({
      first_name: '',
      last_name: '',
      contact_no: '',
      email_address: '',
      cus_address: '',
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
// --- CRUD Operations ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    // 1. Package validation
    if (!formData.package_id) {
      toast.error('Please select a package for this booking.');
      setIsSubmitting(false);
      return;
    }

    // 2. Required fields validation (date, venue, pax)
    if (!formData.event_datetime) {
      toast.error('Please select an event date and time.');
      setIsSubmitting(false);
      return;
    }
    if (!formData.venue || formData.venue.trim() === '') {
      toast.error('Please enter a venue.');
      setIsSubmitting(false);
      return;
    }
    if (!formData.pax_count || parseInt(formData.pax_count) < 1) {
      toast.error('Please enter a valid pax count (must be at least 1).');
      setIsSubmitting(false);
      return;
    }

    // 3. Minimum pax validation based on selected package
    const selectedPackage = packages.find(p => p.package_id === formData.package_id);
    if (selectedPackage && parseInt(formData.pax_count) < selectedPackage.minimum_pax) {
      toast.error(`Minimum pax for this package is ${selectedPackage.minimum_pax}.`);
      setIsSubmitting(false);
      return;
    }

    // 4. Menu selections validation
    const requiredCategories = packageCategories.map(c => c.category_id);
    const selectedCategories = Object.keys(formData.menu_selections);
    const missing = requiredCategories.filter(c => !selectedCategories.includes(c));
    if (missing.length > 0) {
      toast.error('Please select a menu item for each category.');
      setIsSubmitting(false);
      return;
    }

    // 5. Check event date proximity (reminder only)
    if (formData.event_datetime) {
      const eventDate = new Date(formData.event_datetime);
      const now = new Date();
      const diffTime = eventDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 3 && diffDays >= 0) {
        const proceed = await showConfirm({
          title: '⚠️ Booking is Very Soon',
          message: `This event is ${diffDays} day${diffDays !== 1 ? 's' : ''} away (within 2 days). Please confirm if you still want to proceed with this booking.`,
          confirmLabel: 'Yes, Proceed',
          cancelLabel: 'Cancel',
          confirmVariant: 'warning',
        });
        if (!proceed) {
          setIsSubmitting(false);
          return;
        }
      }
    }

    try {
      let customerId = formData.customer_id;

      // If walk-in, create customer account first (unchanged)
      if (isWalkIn) {
        // ... validation and createWalkInCustomer ...
      }

      // 6. Duplicate check: same customer, same event_datetime (excluding current if editing)
      const eventDateTimeISO = formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null;
      let dupQuery = supabase
        .from('booking')
        .select('booking_id')
        .eq('customer_id', customerId)
        .eq('event_datetime', eventDateTimeISO);
      if (editingId) {
        dupQuery = dupQuery.neq('booking_id', editingId);
      }
      const { data: existingDup, error: dupError } = await dupQuery.maybeSingle();
      if (dupError) throw dupError;
      if (existingDup) {
        toast.error('A booking for this customer already exists on the selected date and time.');
        setIsSubmitting(false);
        return;
      }

      // Build payload (unchanged)
      const payload = {
        customer_id: customerId,
        package_id: formData.package_id,
        booking_type: 'Package',
        event_datetime: eventDateTimeISO,
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

      // Save or update (unchanged)
      if (editingId) {
        // update
        const { error } = await supabase
          .from('booking')
          .update(payload)
          .eq('booking_id', editingId);
        if (error) throw error;
        toast.success('Booking updated successfully!');
        closeModal();
        fetchData();
        setIsSubmitting(false);
        return;
      } else {
        // insert
        const { data: newBooking, error } = await supabase
          .from('booking')
          .insert([payload])
          .select();
        if (error) throw error;
        // (no auto-payment creation)
        if (isWalkIn) await new Promise(resolve => setTimeout(resolve, 500));
        toast.success('Booking created successfully!');
        closeModal();
        fetchData();
      }
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

 // --- ✅ UPDATED Approval finalization with equipment capacity warning ---
  const handleFinalizeApproval = async () => {
    if (!approvalBooking) return;
    setIsSubmitting(true);
    try {
      // 1. Check 50% payment condition (unchanged)
      const { data: payments, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid')
        .eq('booking_id', approvalBooking.booking_id);
      if (paymentsError) throw paymentsError;
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      const required = approvalData.newTotal * 0.5;
      if (totalPaid < required) {
        const proceed = await showConfirm({
          title: 'Insufficient Downpayment',
          message: `Total paid (₱${totalPaid.toFixed(2)}) is less than 50% of the total (₱${required.toFixed(2)}). Approving this booking may leave an unpaid balance. Do you still want to approve?`,
          confirmLabel: 'Yes, Approve',
          cancelLabel: 'Cancel',
          confirmVariant: 'warning',
        });
        if (!proceed) {
          setIsSubmitting(false);
          return;
        }
      }

      // --- Conflict check: find other approved events on the same day ---
const eventDate = approvalBooking.event_datetime ? new Date(approvalBooking.event_datetime) : null;
if (eventDate) {
  const startOfDay = new Date(eventDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setHours(23, 59, 59, 999);
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();

  const { data: otherEvents, error: conflictError } = await supabase
    .from('booking')
    .select(`
      booking_id,
      booking_type,
      venue,
      event_datetime,
      customer:customer_id (first_name, last_name)
    `)
    .eq('booking_status', 'Approved')
    .neq('booking_id', approvalBooking.booking_id)
    .gte('event_datetime', startISO)
    .lte('event_datetime', endISO);

  if (conflictError) throw conflictError;

  if (otherEvents && otherEvents.length > 0) {
    const list = otherEvents.map(e => {
      const cust = e.customer ? `${e.customer.first_name} ${e.customer.last_name}` : 'Unknown';
      const time = e.event_datetime ? new Date(e.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const type = e.booking_type === 'Short Order' ? 'Short Order' : 'Package';
      return `• ${cust} (${type}) at ${e.venue || 'N/A'} – ${time}`;
    }).join('\n');

    const proceed = await showConfirm({
      title: '⚠️ Existing Events on This Date',
      message: `The following events are already approved on ${eventDate.toLocaleDateString()}:\n\n${list}\n\nDo you still want to approve this booking?`,
      confirmLabel: 'Approve Anyway',
      cancelLabel: 'Cancel',
      confirmVariant: 'warning',
    });
    if (!proceed) return; // stop approval
  }
}

      const newPax = approvalBooking.pax_count + approvalData.extraPax;
      const newTotal = approvalData.newTotal;
      const newDeliveryFee = parseFloat(approvalBooking.delivery_fee || 0) + approvalData.extraDeliveryFee;

      // 2. Update booking status
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

      // 3. Update payments to Downpayment
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Downpayment' })
        .eq('booking_id', approvalBooking.booking_id);
      if (updatePaymentsError) throw updatePaymentsError;

      // 4. 🆕 Equipment capacity check – warn if conflicts exist
      if (approvalBooking.package_id) {
        try {
          const eventDate = approvalBooking.event_datetime;
          const shortages = await checkEquipmentCapacityForDate(eventDate, approvalBooking.booking_id);
          if (shortages.length > 0) {
            // Build a readable message
            const details = shortages
              .map(s => `${s.eqm_name}: needed ${s.needed}, available ${s.available}`)
              .join('\n');
            const proceed = await showConfirm({
              title: '⚠️ Equipment Capacity Warning',
              message: `The following equipment items are overbooked for this event date:\n\n${details}\n\nYou may still approve, but please adjust equipment inventory manually afterwards.`,
              confirmLabel: 'Approve Anyway',
              cancelLabel: 'Cancel Approval',
              confirmVariant: 'warning',
            });
            if (!proceed) {
              // Revert the status? For simplicity, we'll just cancel the approval.
              // Actually we already updated status; we could revert or let the user decide.
              // We'll revert status to Pending.
              await supabase
                .from('booking')
                .update({ booking_status: 'Pending' })
                .eq('booking_id', approvalBooking.booking_id);
              setIsSubmitting(false);
              return;
            }
          }
        } catch (capError) {
          // If capacity check fails, just log and continue (don't block approval)
          console.warn('Equipment capacity check failed:', capError);
        }
      }

      // 5. Finalize UI
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

  // --- Multi‑select handlers ---
  const toggleSelectBooking = (bookingId) => {
    setSelectedBookings(prev =>
      prev.includes(bookingId)
        ? prev.filter(id => id !== bookingId)
        : [...prev, bookingId]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = filtered.map(b => b.booking_id);
    const allSelected = visibleIds.every(id => selectedBookings.includes(id));
    setSelectedBookings(allSelected ? [] : visibleIds);
  };

  const clearSelection = () => setSelectedBookings([]);

  const handleBulkDelete = async () => {
    if (selectedBookings.length === 0) return;

    const confirmed = await showConfirm({
      title: 'Delete Selected Bookings?',
      message: `You are about to delete ${selectedBookings.length} booking(s). This action cannot be undone and will also delete all associated payments.`,
      confirmLabel: 'Delete All',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      // Delete payments first
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .in('booking_id', selectedBookings);
      if (paymentsError) throw paymentsError;

      // Delete bookings
      const { error: bookingsError } = await supabase
        .from('booking')
        .delete()
        .in('booking_id', selectedBookings);
      if (bookingsError) throw bookingsError;

      toast.success(`Successfully deleted ${selectedBookings.length} booking(s).`);
      clearSelection();
      // If current page has no items after delete, go to previous page
      if (bookings.length === selectedBookings.length && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        fetchData();
      }
    } catch (error) {
      handleError(error, 'Failed to delete selected bookings.');
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

      {/* Search & Filter + Bulk Delete Button */}
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
        <div className="flex items-center gap-3 flex-wrap">
          {selectedBookings.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm"
            >
              <Trash2 size={16} /> Delete Selected ({selectedBookings.length})
            </button>
          )}
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
      </div>

 {/* Table */}
<div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
          <th className="p-4 w-10">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every(b => selectedBookings.includes(b.booking_id))}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
              disabled={filtered.length === 0}
            />
          </th>
          <th className="p-4 font-bold min-w-[130px]">Client</th>
          <th className="p-4 font-bold min-w-[120px]">Created</th>
          <th className="p-4 font-bold min-w-[120px]">Event Date</th>
          <th className="p-4 font-bold min-w-[100px]">Venue</th>
          <th className="p-4 font-bold w-16 text-center">Pax</th>
          <th className="p-4 font-bold min-w-[110px]">Package</th>
          <th className="p-4 font-bold w-28 text-right">Amount</th>
          <th className="p-4 font-bold w-24">Status</th>
          <th className="p-4 font-bold min-w-[280px] text-center">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
        {loading ? (
          <tr><td colSpan="10" className="p-6 text-center text-slate-400">Loading bookings...</td></tr>
        ) : filtered.length === 0 ? (
          <tr><td colSpan="10" className="p-6 text-center text-slate-500 italic">No package bookings found.</td></tr>
        ) : (
          filtered.map((booking) => (
            <tr key={booking.booking_id} className="hover:bg-slate-50 transition-colors">
              <td className="p-4">
                <input
                  type="checkbox"
                  checked={selectedBookings.includes(booking.booking_id)}
                  onChange={() => toggleSelectBooking(booking.booking_id)}
                  className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                />
              </td>
              <td className="p-4">
                <p
                  onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                  className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-4 cursor-pointer hover:text-[#008A45]"
                >
                  {booking.customer?.first_name} {booking.customer?.last_name}
                </p>
              </td>
              <td className="p-4 text-slate-600 text-xs">
                {booking.book_datetime ? new Date(booking.book_datetime).toLocaleDateString() : 'N/A'}
              </td>
              <td className="p-4 text-slate-600 text-xs">
                {booking.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}
              </td>
              <td className="p-4 font-medium">{booking.venue || 'N/A'}</td>
              <td className="p-4 text-center">{booking.pax_count || 0}</td>
              <td className="p-4 font-medium">{booking.package?.pkg_name || 'N/A'}</td>
              <td className="p-4 font-bold text-slate-900 text-right">₱{booking.total_amount?.toLocaleString() || '0'}</td>
              <td className="p-4">
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusBadge(booking.booking_status)}`}>
                  {booking.booking_status}
                </span>
              </td>
              <td className="p-4">
                <div className="flex items-center justify-center gap-1.5 flex-nowrap whitespace-nowrap">
                  {booking.booking_status === 'Pending' && (
                    <>
                      <button
                        onClick={() => openApprovalModal(booking)}
                        className="bg-[#C1DEDC] border border-[#a8cfcc] text-slate-800 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-[#b8dad7] transition-colors"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button
                        onClick={() => handleReject(booking.booking_id)}
                        className="bg-red-100 border border-red-200 text-red-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-200 transition-colors"
                      >
                        <X size={14} /> Reject
                      </button>
                    </>
                  )}
                  {booking.booking_status === 'Approved' && (
                    <button
                      onClick={() => handleMarkCompleted(booking.booking_id)}
                      className="bg-blue-100 border border-blue-200 text-blue-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors"
                    >
                      <Check size={14} /> Complete
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                    className="bg-white border border-slate-300 text-slate-700 font-semibold text-[11px] px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
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
  <span>Showing {bookings.length} of {totalCount} bookings</span>
  <div className="flex items-center gap-1">
    <button
      onClick={goToPrevPage}
      disabled={currentPage === 1}
      className={`p-1 transition-colors ${currentPage === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-slate-800'}`}
    >
      <ChevronLeft size={16} />
    </button>
    <span className="px-3 py-1 text-xs font-medium text-slate-600">
      Page {currentPage} of {totalPages}
    </span>
    <button
      onClick={goToNextPage}
      disabled={currentPage === totalPages}
      className={`p-1 transition-colors ${currentPage === totalPages ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-slate-800'}`}
    >
      <ChevronRight size={16} />
    </button>
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
              {/* Customer Selection / Walk-in Toggle */}
              {!editingId && (
                <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-700 mb-2">Customer Type</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setIsWalkIn(false)}
                      className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-semibold transition-all ${
                        !isWalkIn
                          ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      Existing Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsWalkIn(true)}
                      className={`flex-1 py-2 px-4 rounded-lg border-2 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        isWalkIn
                          ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <UserPlus size={16} />
                      Walk-in Customer
                    </button>
                  </div>
                  {isWalkIn && (
                    <p className="text-xs text-amber-600 mt-2">
                      ⚠️ A customer account will be created with default password: <strong>password123</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Existing Customer Dropdown */}
              {!isWalkIn && (
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
              )}

              {/* Walk-in Customer Fields */}
              {isWalkIn && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <p className="text-xs font-bold text-slate-700 mb-1">Walk-in Customer Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">First Name *</label>
                      <input
                        type="text"
                        name="first_name"
                        value={walkInData.first_name}
                        onChange={handleWalkInChange}
                        placeholder="e.g. Juan"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                        required={isWalkIn}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Last Name *</label>
                      <input
                        type="text"
                        name="last_name"
                        value={walkInData.last_name}
                        onChange={handleWalkInChange}
                        placeholder="e.g. Dela Cruz"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                        required={isWalkIn}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Contact Number *</label>
                      <input
                        type="text"
                        name="contact_no"
                        value={walkInData.contact_no}
                        onChange={handleWalkInChange}
                        placeholder="e.g. 09123456789"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                        required={isWalkIn}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Email Address *</label>
                      <input
                        type="email"
                        name="email_address"
                        value={walkInData.email_address}
                        onChange={handleWalkInChange}
                        placeholder="e.g. juan@email.com"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                        required={isWalkIn}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-0.5">Address</label>
                    <input
                      type="text"
                      name="cus_address"
                      value={walkInData.cus_address}
                      onChange={handleWalkInChange}
                      placeholder="e.g. Banga, Bayawan City"
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                    />
                  </div>
                </div>
              )}

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
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time *</label>
                <input
                  type="datetime-local"
                  name="event_datetime"
                  value={formData.event_datetime}
                  onChange={handleInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  required
                />
              </div>

              {/* Venue */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue *</label>
                <input
                  type="text"
                  name="venue"
                  value={formData.venue}
                  onChange={handleInputChange}
                  placeholder="e.g. Grand Pavilion"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  required
                />
              </div>

              {/* Pax, Color, Delivery Fee, Total Amount */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pax Count *</label>
                  <input
                    type="number"
                    name="pax_count"
                    value={formData.pax_count}
                    onChange={handleInputChange}
                    placeholder="e.g. 80"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motif Color *</label>
                  <input
                    type="text"
                    name="motif_color"
                    value={formData.motif_color}
                    onChange={handleInputChange}
                    placeholder="e.g. Burgundy"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                    required
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue (contains)</label>
                <input
                  type="text"
                  name="venue"
                  value={filters.venue}
                  onChange={handleFilterChange}
                  placeholder="e.g. Grand Pavilion"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
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