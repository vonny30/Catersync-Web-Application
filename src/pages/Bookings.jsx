// src/pages/Bookings.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Check, Edit, Trash2, ChevronLeft, ChevronRight,
  Filter, X, RefreshCw, RotateCcw, UserPlus, Image as ImageIcon, User, Users
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { checkEquipmentCapacityForDate, allocateEquipmentForBooking } from '../utils/equipment';
import { createWalkInCustomer } from '../utils/createWalkInCustomer';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';

export default function Bookings() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBookings, setSelectedBookings] = useState([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    customerId: '',
    packageId: '',
    venue: '',
    status: '',
  });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [customerMode, setCustomerMode] = useState('existing');
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

  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [showCustomerList, setShowCustomerList] = useState(false);

  const [packageCategories, setPackageCategories] = useState([]);
  const [categoryMenuItems, setCategoryMenuItems] = useState({});

  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // Auto-calculate total amount (no delivery fee)
  useEffect(() => {
    if (formData.package_id && formData.pax_count) {
      const selectedPkg = packages.find(p => p.package_id === formData.package_id);
      if (selectedPkg) {
        const pax = parseInt(formData.pax_count) || 0;
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

        setFormData(prev => ({
          ...prev,
          total_amount: baseTotal.toFixed(2),
        }));
      }
    }
  }, [formData.package_id, formData.pax_count, packages]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('booking')
        .select('*', { count: 'exact' })
        .eq('booking_type', 'Package');

      if (activeTab !== 'All') {
        query = query.eq('booking_status', activeTab);
      }

      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        query = query.gte('event_datetime', fromDate.toISOString());
      }
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999);
        query = query.lte('event_datetime', toDate.toISOString());
      }

      if (filters.customerId) query = query.eq('customer_id', filters.customerId);
      if (filters.packageId) query = query.eq('package_id', filters.packageId);
      if (filters.venue) query = query.ilike('venue', `%${filters.venue}%`);

// --- SEARCH ---
if (searchTerm) {
  const search = searchTerm.trim();
  if (search) {
    // Split search into individual words
    const parts = search.split(' ').filter(p => p.length > 0);
    
    // Build OR conditions for each part
    const conditions = [];
    parts.forEach(part => {
      conditions.push(`first_name.ilike.%${part}%`);
      conditions.push(`last_name.ilike.%${part}%`);
    });
    
    const queryCondition = conditions.join(',');
    
    let customerIds = [];
    try {
      const { data: matchingCustomers } = await supabase
        .from('customer')
        .select('customer_id')
        .or(queryCondition);
      
      customerIds = (matchingCustomers || []).map(c => c.customer_id);
    } catch (e) {
      console.warn('Customer search failed:', e);
    }
    
    if (customerIds.length > 0) {
      query = query.in('customer_id', customerIds);
    } else {
      // No matches – force empty result
      query = query.eq('customer_id', '00000000-0000-0000-0000-000000000000');
    }
  }
}

      query = query
        .order('status_order', { ascending: true })
        .order('is_read', { ascending: true })
        .order('book_datetime', { ascending: false })
        .range(from, to);

      const { data: bookingsData, count, error: bookingsError } = await query;
      if (bookingsError) throw bookingsError;

      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / pageSize));

      if (bookingsData && bookingsData.length > 0) {
        const customerIds = bookingsData.map(b => b.customer_id).filter(id => id);
        const packageIds = bookingsData.map(b => b.package_id).filter(id => id);
        const bookingIds = bookingsData.map(b => b.booking_id);

        let customersMap = {};
        if (customerIds.length > 0) {
          const { data: customersData, error: customersError } = await supabase
            .from('customer')
            .select('customer_id, first_name, last_name, contact_no')
            .in('customer_id', customerIds);
          if (customersError) throw customersError;
          customersMap = Object.fromEntries(customersData.map(c => [c.customer_id, c]));
        }

        let packagesMap = {};
        if (packageIds.length > 0) {
          const { data: packagesData, error: packagesError } = await supabase
            .from('package')
            .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax, colors')
            .in('package_id', packageIds);
          if (packagesError) throw packagesError;
          packagesMap = Object.fromEntries(packagesData.map(p => [p.package_id, p]));
        }

        let paymentsMap = {};
        if (bookingIds.length > 0) {
          const { data: paymentsData, error: paymentsError } = await supabase
            .from('payment')
            .select('booking_id, amount_paid, pay_status')
            .in('booking_id', bookingIds)
            .not('amount_paid', 'eq', 0)
            .not('pay_status', 'eq', 'Pending');
          if (paymentsError) throw paymentsError;

          paymentsMap = {};
          for (const p of paymentsData) {
            if (!paymentsMap[p.booking_id]) {
              paymentsMap[p.booking_id] = { positive: 0, refunded: 0, downpayment: 0 };
            }
            const amount = parseFloat(p.amount_paid) || 0;
            // Pending Verification / Proof Rejected rows aren't confirmed
            // funds yet, so they don't count toward what's actually paid.
            const isUnverified = p.pay_status === 'Pending Verification' || p.pay_status === 'Proof Rejected';
            if (amount > 0 && !isUnverified) {
              paymentsMap[p.booking_id].positive += amount;
              if (p.pay_status === 'Downpayment') {
                paymentsMap[p.booking_id].downpayment += amount;
              }
            } else if (amount < 0) {
              paymentsMap[p.booking_id].refunded += Math.abs(amount);
            }
          }
        }

        const now = new Date();
        const enriched = bookingsData.map(booking => {
          const p = paymentsMap[booking.booking_id] || { positive: 0, refunded: 0, downpayment: 0 };
          const positivePayments = p.positive;
          const totalRefunded = p.refunded;
          const downpaymentPaid = p.downpayment;

          let refundStatus = null;
          let isRefundable = false;
          if (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') {
            const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
            let daysUntilEvent = null;
            if (eventDate) {
              const diffTime = eventDate.getTime() - now.getTime();
              daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              isRefundable = daysUntilEvent >= 3;
            }
            if (positivePayments > 0) {
              if (totalRefunded >= positivePayments) {
                refundStatus = 'Fully Refunded';
              } else if (isRefundable) {
                refundStatus = 'Refundable';
              } else {
                refundStatus = 'Non-Refundable';
              }
            } else {
              refundStatus = 'No Payments';
            }
          }

          return {
            ...booking,
            customer: customersMap[booking.customer_id] || null,
            package: packagesMap[booking.package_id] || null,
            positivePayments,
            totalRefunded,
            downpaymentPaid,
            refundStatus,
          };
        });
        setBookings(enriched);
      } else {
        setBookings([]);
      }

      const { data: customersList, error: customersListError } = await supabase
        .from('customer')
        .select('customer_id, first_name, last_name, contact_no, email_address')
        .eq('account_status', 'Active')
        .order('first_name');
      if (customersListError) throw customersListError;
      setCustomers(customersList || []);

      const { data: packagesList, error: packagesListError } = await supabase
        .from('package')
        .select('package_id, pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax, colors')
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

  // Approval Hook
  const {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking,
    approvalData,
    isSubmitting: isApprovalSubmitting,
    openApprovalModal,
    handleApprovalInputChange,
    handleFinalizeApproval,
  } = useApprovalHandlers({
    booking: null,
    payments: [],
    fetchData: fetchData,
  });

  // Reported by ApprovalAvailabilityCheck inside the approve modal — lets us
  // disable the Approve button instead of letting the manager click through
  // and get blocked by the hook's equipment hard-check afterward.
  const [approvalEquipmentStatus, setApprovalEquipmentStatus] = useState({ applicable: false, loading: false, sufficient: true, shortages: [] });
  const approveDisabled = isApprovalSubmitting || (approvalEquipmentStatus.applicable && (approvalEquipmentStatus.loading || !approvalEquipmentStatus.sufficient));

  // Rejection Hook with callbacks
  const getBooking = (id) => bookings.find(b => b.booking_id === id);
  const getPaymentSummary = (id) => {
    const b = getBooking(id);
    return b ? { positivePayments: b.positivePayments, downpaymentPaid: b.downpaymentPaid } : { positivePayments: 0, downpaymentPaid: 0 };
  };

  const {
    isRejectionModalOpen,
    setIsRejectionModalOpen,
    rejectionReason,
    setRejectionReason,
    rejectionRefundAmount,
    setRejectionRefundAmount,
    rejectionRefundRemarks,
    setRejectionRefundRemarks,
    rejectionRefundFile,
    setRejectionRefundFile,
    showRejectionRefund,
    rejectionMaxRefundable,
    openRejectionModal,
    handleRejectConfirm,
  } = useRejectionHandlers({
    getBooking,
    getPaymentSummary,
    fetchData,
  });

  // Filter customers based on search
  useEffect(() => {
    if (customerSearch.trim() === '') {
      setFilteredCustomers(customers.slice(0, 10));
      return;
    }
    const search = customerSearch.toLowerCase();
    const filtered = customers.filter(c =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(search) ||
      c.contact_no?.includes(search) ||
      c.email_address?.toLowerCase().includes(search)
    );
    setFilteredCustomers(filtered.slice(0, 15));
  }, [customerSearch, customers]);

  useEffect(() => {
    fetchData();
  }, [currentPage, activeTab, searchTerm, filters]);

  const goToPrevPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToNextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };

  // 5. ✅ REAL‑TIME SUBSCRIPTION (MUST be at top level, NOT inside fetchData)
  useEffect(() => {
    const subscription = supabase
      .channel('booking-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking',
          filter: `booking_type=eq.Package`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []); // empty deps – subscribe once

  // 6. Fetch package categories and menu items when package changes in modal
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
          .select(`category_id, category:category_id (category_id, category_name)`)
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

  const selectCustomer = (customer) => {
    setFormData(prev => ({ ...prev, customer_id: customer.customer_id }));
    setCustomerSearch(`${customer.first_name} ${customer.last_name}`);
    setShowCustomerList(false);
  };

  const markAsRead = async (bookingId) => {
    try {
      await supabase
        .from('booking')
        .update({ is_read: true })
        .eq('booking_id', bookingId);
      await fetchData();
    } catch (error) {
      console.warn('Failed to mark as read:', error);
    }
  };

  const openNewBookingModal = () => {
    setEditingId(null);
    setCustomerMode('existing');
    setCustomerSearch('');
    setShowCustomerList(false);
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
      menu_selections: {},
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setPackageCategories([]);
    setCategoryMenuItems({});
    setIsModalOpen(true);
  };

  const openEditModal = (booking) => {
    setEditingId(booking.booking_id);
    setCustomerMode('existing');
    setCustomerSearch('');
    setShowCustomerList(false);
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
      menu_selections: booking.menu_selections || {},
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setCustomerMode('existing');
    setCustomerSearch('');
    setShowCustomerList(false);
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
      menu_selections: {},
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setPackageCategories([]);
    setCategoryMenuItems({});
    setIsSubmitting(false);
  };

  const openFilterModal = () => setIsFilterModalOpen(true);
  const closeFilterModal = () => setIsFilterModalOpen(false);
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };
  const applyFilters = () => {
    setIsFilterModalOpen(false);
    setCurrentPage(1);
  };
  const clearFilters = () => {
    setFilters({ dateFrom: '', dateTo: '', customerId: '', packageId: '', venue: '', status: '' });
    setCurrentPage(1);
  };

  // CRUD Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const eventDateTimeISO = formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null;

    if (!editingId) {
      if (customerMode === 'existing' && !formData.customer_id) {
        toast.error('Please select an existing customer.');
        setIsSubmitting(false);
        return;
      }
      if (customerMode === 'new') {
        if (!walkInData.first_name || !walkInData.last_name || !walkInData.contact_no || !walkInData.email_address) {
          toast.error('Please fill in all customer details for walk-in customer.');
          setIsSubmitting(false);
          return;
        }
        if (!walkInData.email_address.includes('@')) {
          toast.error('Please enter a valid email address.');
          setIsSubmitting(false);
          return;
        }
        const phoneRegex = /^[0-9]{11}$/;
        if (!phoneRegex.test(walkInData.contact_no)) {
          toast.error('Contact number must be exactly 11 digits (numbers only).');
          setIsSubmitting(false);
          return;
        }
      }
    } else {
      if (!formData.customer_id) {
        toast.error('Customer is required for this booking.');
        setIsSubmitting(false);
        return;
      }
    }

    if (!formData.package_id) {
      toast.error('Please select a package for this booking.');
      setIsSubmitting(false);
      return;
    }
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
    if (!formData.total_amount || parseFloat(formData.total_amount) <= 0) {
      toast.error('Total amount must be greater than zero.');
      setIsSubmitting(false);
      return;
    }

    const selectedPackage = packages.find(p => p.package_id === formData.package_id);
    if (selectedPackage && parseInt(formData.pax_count) < selectedPackage.minimum_pax) {
      toast.error(`Minimum pax for this package is ${selectedPackage.minimum_pax}.`);
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

    if (formData.event_datetime) {
      const eventDate = new Date(formData.event_datetime);
      const now = new Date();
      const diffTime = eventDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        const proceed = await showConfirm({
          title: '⚠️ Event Date is in the Past',
          message: `This event date is ${Math.abs(diffDays)} days ago. Creating a booking for a past date may affect reports and operations. Do you still want to proceed?`,
          confirmLabel: 'Yes, Proceed Anyway',
          cancelLabel: 'Cancel',
          confirmVariant: 'warning',
        });
        if (!proceed) {
          setIsSubmitting(false);
          return;
        }
      } else if (diffDays >= 0 && diffDays < 3) {
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

      if (customerMode === 'new') {
        try {
          customerId = await createWalkInCustomer(walkInData);
          if (!customerId) {
            toast.error('Failed to create customer account.');
            setIsSubmitting(false);
            return;
          }
        } catch (err) {
          toast.error(err.message);
          setIsSubmitting(false);
          return;
        }
      }

      // ✅ DUPLICATE CHECK – only active bookings (not Rejected or Cancelled).
      // Skipped for a brand-new walk-in customer: they were just created a
      // few lines up, so they can't possibly already have a booking on
      // this date — and running the check (and letting the manager Cancel
      // out of it) would leave the account we just created orphaned with
      // no booking attached to it.
      const eventDate = new Date(formData.event_datetime);
      if (customerMode !== 'new') {
        const startOfDay = new Date(eventDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(eventDate);
        endOfDay.setHours(23, 59, 59, 999);
        const startISO = startOfDay.toISOString();
        const endISO = endOfDay.toISOString();

        let dupQuery = supabase
        .from('booking')
        .select('booking_id, venue, pax_count, booking_status, event_datetime, package_id')
        .eq('customer_id', customerId)
        .eq('booking_type', 'Package')        // <-- ADD THIS LINE
        .gte('event_datetime', startISO)
        .lte('event_datetime', endISO)
        .not('booking_status', 'in', '("Rejected","Cancelled")');

        if (editingId) {
          dupQuery = dupQuery.neq('booking_id', editingId);
        }

        const { data: duplicates, error: dupError } = await dupQuery;
        if (dupError) {
          console.error('Duplicate check error:', dupError);
        } else if (duplicates && duplicates.length > 0) {
          const existing = duplicates[0];
          const { data: customerData } = await supabase
            .from('customer')
            .select('first_name, last_name')
            .eq('customer_id', customerId)
            .maybeSingle();

          let packageName = 'No Package';
          if (existing.package_id) {
            const { data: pkgData } = await supabase
              .from('package')
              .select('pkg_name')
              .eq('package_id', existing.package_id)
              .maybeSingle();
            if (pkgData) packageName = pkgData.pkg_name;
          }

          const customerName = customerData
            ? `${customerData.first_name} ${customerData.last_name}`
            : 'Unknown Customer';

          const existingTime = existing.event_datetime
            ? new Date(existing.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Unknown Time';
          const venue = existing.venue || 'N/A';
          const pax = existing.pax_count || 0;
          const status = existing.booking_status || 'Unknown';
          const count = duplicates.length;

          let message = `⚠️ Duplicate Booking Found\n\n`;
          if (count > 1) message += `Found ${count} bookings on this date. Showing the first one:\n\n`;
          message +=
            `Customer  : ${customerName}\n` +
            `Date      : ${new Date(eventDate).toLocaleDateString()}\n` +
            `Time      : ${existingTime}\n` +
            `Package   : ${packageName}\n` +
            `Venue     : ${venue}\n` +
            `Pax       : ${pax}\n` +
            `Status    : ${status}\n\n` +
            `Do you still want to proceed with this new booking?`;

          const proceed = await showConfirm({
            title: '⚠️ Duplicate Booking Detected',
            message: message,
            confirmLabel: 'Yes, Proceed Anyway',
            cancelLabel: 'Cancel',
            confirmVariant: 'warning',
          });
          if (!proceed) {
            setIsSubmitting(false);
            return;
          }
        }
      }

      // Build payload (no delivery_fee)
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
        booking_status: editingId ? undefined : 'Pending',
        menu_selections: formData.menu_selections,
        ...(editingId
          ? {}
          : {
              book_datetime: new Date().toISOString(),
              is_read: false,
            }),
      };

      if (editingId) {
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
        const { data: newBooking, error } = await supabase
          .from('booking')
          .insert([payload])
          .select();
        if (error) throw error;

        if (customerMode === 'new') await new Promise(resolve => setTimeout(resolve, 500));
        toast.success('Booking created successfully!');
        closeModal();
        fetchData();
      }
    } catch (error) {
      let userMessage = 'Failed to save booking. Please try again.';
      if (error.message) {
        if (error.message.includes('violates foreign key constraint')) {
          userMessage = 'Invalid customer or package selected. Please try again.';
        } else if (error.message.includes('duplicate key')) {
          userMessage = 'A duplicate booking already exists.';
        } else {
          userMessage = error.message;
        }
      }
      handleError(error, userMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ❌ Local rejection functions removed – using hook

  // Approved -> Confirmed: manual step, requires at least 50% verified paid.
  const handleConfirmBooking = async (id) => {
    const booking = bookings.find(b => b.booking_id === id);
    if (!booking) {
      toast.error('Booking not found.');
      return;
    }
    const totalAmount = booking.total_amount || 0;
    const paid = booking.positivePayments || 0;
    const required = totalAmount * 0.5;
    if (paid < required) {
      toast.error(`Needs at least 50% paid and verified before this can be confirmed (₱${paid.toLocaleString()} of ₱${required.toLocaleString()} required).`);
      return;
    }
    const isFullyPaid = paid >= totalAmount;
    const confirmed = await showConfirm({
      title: 'Confirm This Event?',
      message: `This booking has ${isFullyPaid ? 'been paid in full' : 'a verified downpayment of at least 50%'} (₱${paid.toLocaleString()} of ₱${totalAmount.toLocaleString()}). Marking it Confirmed locks the event in — cancellation only becomes available after this point. Continue?`,
      confirmLabel: 'Yes, Confirm Event',
      cancelLabel: 'Cancel',
      confirmVariant: 'success',
    });
    if (!confirmed) return;
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Confirmed' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Event confirmed!');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to confirm booking.');
    }
  };

const handleMarkCompleted = async (id) => {
  const booking = bookings.find(b => b.booking_id === id);
  if (!booking) {
    toast.error('Booking not found.');
    return;
  }

  const totalAmount = booking.total_amount || 0;
  const totalPaid = booking.positivePayments || 0;
  const remainingBalance = Math.max(0, totalAmount - totalPaid);
  const isFullyPaid = remainingBalance <= 0;

  // ✅ Show warning if there's a remaining balance
  if (!isFullyPaid) {
    const proceed = await showConfirm({
      title: '⚠️ Outstanding Balance',
      message: `This booking has a remaining balance of ₱${remainingBalance.toLocaleString()}.\n\nMarking it as "Completed" will close the order, but the balance will remain unpaid.\n\nDo you still want to proceed?`,
      confirmLabel: 'Yes, Complete Anyway',
      cancelLabel: 'Cancel',
      confirmVariant: 'warning',
    });
    if (!proceed) return;
  }

  const confirmed = await showConfirm({
    title: 'Mark as Completed?',
    message: `Are you sure you want to mark this booking as completed?\n\n${!isFullyPaid ? `⚠️ Remaining balance: ₱${remainingBalance.toLocaleString()}` : '✅ All payments are settled.'}`,
    confirmLabel: 'Complete',
    confirmVariant: 'success',
  });
  if (!confirmed) return;

  try {
    // 1. Update booking status
    const { error } = await supabase
      .from('booking')
      .update({ booking_status: 'Completed' })
      .eq('booking_id', id);
    if (error) throw error;

    // 2. Auto-return all equipment for this booking
    const { error: equipReturnError } = await supabase
      .from('booking_equipment')
      .update({
        returned: true,
        returned_at: new Date().toISOString()
      })
      .eq('booking_id', id);
    if (equipReturnError) throw equipReturnError;

    // 3. Auto-complete all vehicle assignments for this booking
    const { error: vehicleReturnError } = await supabase
      .from('vehicle_assign')
      .update({ assignment_status: 'Completed' })
      .eq('booking_id', id);
    if (vehicleReturnError) throw vehicleReturnError;

    // 4. Update payments to Fully Paid if fully paid
    if (isFullyPaid && totalPaid > 0) {
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Fully Paid' })
        .eq('booking_id', id);
      if (updatePaymentsError) throw updatePaymentsError;
      toast.success('Booking marked completed. All payments set to Fully Paid.');
    } else if (!isFullyPaid) {
      toast.warning(`Booking marked completed. ⚠️ Remaining balance: ₱${remainingBalance.toLocaleString()}`);
    } else {
      toast.success('Booking marked completed successfully.');
    }

    // 5. Refresh data
    fetchData();
  } catch (error) {
    handleError(error, 'Failed to complete booking.');
  }
};

  const handleDelete = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: 'Are you sure you want to permanently delete this booking? This action cannot be undone. All associated payments, equipment, and vehicle assignments will also be deleted.',
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

      await supabase.from('booking_equipment').delete().eq('booking_id', id);
      await supabase.from('vehicle_assign').delete().eq('booking_id', id);

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

  const toggleSelectBooking = (bookingId) => {
    setSelectedBookings(prev =>
      prev.includes(bookingId)
        ? prev.filter(id => id !== bookingId)
        : [...prev, bookingId]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = bookings.map(b => b.booking_id);
    const allSelected = visibleIds.every(id => selectedBookings.includes(id));
    setSelectedBookings(allSelected ? [] : visibleIds);
  };

  const clearSelection = () => setSelectedBookings([]);

  const handleBulkDelete = async () => {
    if (selectedBookings.length === 0) return;
    const confirmed = await showConfirm({
      title: 'Delete Selected Bookings?',
      message: `You are about to delete ${selectedBookings.length} booking(s). This action cannot be undone and will also delete all associated payments, equipment, and vehicle assignments.`,
      confirmLabel: 'Delete All',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      await supabase.from('payment').delete().in('booking_id', selectedBookings);
      await supabase.from('booking_equipment').delete().in('booking_id', selectedBookings);
      await supabase.from('vehicle_assign').delete().in('booking_id', selectedBookings);
      const { error: bookingsError } = await supabase
        .from('booking')
        .delete()
        .in('booking_id', selectedBookings);
      if (bookingsError) throw bookingsError;

      toast.success(`Successfully deleted ${selectedBookings.length} booking(s).`);
      clearSelection();
      if (bookings.length === selectedBookings.length && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        fetchData();
      }
    } catch (error) {
      handleError(error, 'Failed to delete selected bookings.');
    }
  };

  const tabs = ['All', 'Pending', 'Approved', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'];
  const hasActiveFilters = filters.dateFrom || filters.dateTo || filters.customerId || filters.packageId || filters.venue;

  const getStatusBadge = (status) => {
    const map = {
      Pending: 'bg-amber-50 border-amber-200 text-amber-700',
      Approved: 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800',
      Confirmed: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      Completed: 'bg-blue-50 border-blue-200 text-blue-700',
      Rejected: 'bg-red-50 border-red-200 text-red-700',
      Cancelled: 'bg-slate-100 border-slate-300 text-slate-600',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  const getRefundStatusBadge = (status) => {
    if (!status) return null;
    const map = {
      'Refundable': 'bg-green-50 border-green-200 text-green-700',
      'Non-Refundable': 'bg-red-50 border-red-200 text-red-700',
      'Fully Refunded': 'bg-blue-50 border-blue-200 text-blue-700',
      'No Payments': 'bg-slate-50 border-slate-200 text-slate-500',
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
            onClick={() => {
              setActiveTab(tab);
              setCurrentPage(1);
            }}
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
              <RotateCcw size={16} /> Clear
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
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={bookings.length > 0 && bookings.every(b => selectedBookings.includes(b.booking_id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                    disabled={bookings.length === 0}
                  />
                </th>
                <th className="p-4 font-bold min-w-[130px]">Client</th>
                <th className="p-4 font-bold min-w-[120px]">Created</th>
                <th className="p-4 font-bold min-w-[120px]">Event Date</th>
                <th className="p-4 font-bold min-w-[100px]">Venue</th>
                <th className="p-4 font-bold w-16 text-center">Pax</th>
                <th className="p-4 font-bold min-w-[110px]">Package</th>
                <th className="p-4 font-bold w-28 text-right">Amount</th>
                <th className="p-4 font-bold min-w-[120px] text-center">Status</th>
                <th className="p-4 font-bold min-w-[280px] text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-400">Loading bookings...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-500 italic">No package bookings found.</td></tr>
              ) : (
                bookings.map((booking) => (
                  <tr
                    key={booking.booking_id}
                    className={`hover:bg-slate-50 transition-colors ${!booking.is_read ? 'font-bold' : ''}`}
                    onClick={() => {
                      if (!booking.is_read) {
                        markAsRead(booking.booking_id);
                      }
                    }}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedBookings.includes(booking.booking_id)}
                        onChange={() => toggleSelectBooking(booking.booking_id)}
                        className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <p
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/app/bookings/${booking.booking_id}`);
                          }}
                          className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-4 cursor-pointer hover:text-[#008A45]"
                        >
                          {booking.customer?.first_name} {booking.customer?.last_name}
                        </p>
                        {!booking.is_read && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200 animate-pulse">
                            NEW
                          </span>
                        )}
                      </div>
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
  <div className="flex flex-col items-center gap-1">
    <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusBadge(booking.booking_status)} inline-block w-[120px] text-center`}>
      {booking.booking_status}
    </span>
    {booking.booking_status === 'Completed' && booking.positivePayments < (booking.total_amount || 0) && (
      <span className="px-3 py-1.5 rounded-full text-xs font-bold border bg-amber-50 border-amber-200 text-amber-700 inline-block w-[120px] text-center">
        Balance Remaining
      </span>
    )}
    {(booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && booking.refundStatus && (
      <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getRefundStatusBadge(booking.refundStatus)} inline-block w-[120px] text-center`}>
        {booking.refundStatus}
      </span>
    )}
  </div>
</td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5 flex-nowrap whitespace-nowrap">
                        {booking.booking_status === 'Pending' && (
                          <>
                            <button
                              onClick={() => openApprovalModal(booking)}
                              className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition-colors"
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button
                              onClick={() => openRejectionModal(booking.booking_id)}
                              className="bg-red-100 border border-red-200 text-red-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-200 transition-colors"
                            >
                              <X size={14} /> Reject
                            </button>
                          </>
                        )}
                        {booking.booking_status === 'Approved' && (
                          <button
                            onClick={() => handleConfirmBooking(booking.booking_id)}
                            className="bg-emerald-100 border border-emerald-200 text-emerald-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-emerald-200 transition-colors"
                          >
                            <Check size={14} /> Confirm
                          </button>
                        )}
                        {booking.booking_status === 'Confirmed' && (
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

      {/* NEW/EDIT BOOKING MODAL (delivery fee removed) */}
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
              {/* Customer Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer</label>
                {editingId ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700">
                    {customers.find(c => c.customer_id === formData.customer_id)?.first_name}{' '}
                    {customers.find(c => c.customer_id === formData.customer_id)?.last_name}
                    <span className="ml-2 text-xs font-normal text-slate-400">(Cannot change in edit mode)</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerMode('existing');
                          setFormData(prev => ({ ...prev, customer_id: '' }));
                          setCustomerSearch('');
                          setShowCustomerList(false);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 font-semibold text-sm transition-all ${
                          customerMode === 'existing'
                            ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                            : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        <Users size={18} /> Existing Customer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerMode('new');
                          setFormData(prev => ({ ...prev, customer_id: '' }));
                          setCustomerSearch('');
                          setShowCustomerList(false);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 font-semibold text-sm transition-all ${
                          customerMode === 'new'
                            ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                            : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        <UserPlus size={18} /> Walk-in / New Customer
                      </button>
                    </div>

                    {customerMode === 'existing' && (
                      <div>
                        <div className="relative">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                              type="text"
                              value={customerSearch}
                              onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setShowCustomerList(true);
                              }}
                              onFocus={() => setShowCustomerList(true)}
                              placeholder="Search by name, phone, or email..."
                              className="w-full border border-slate-300 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                            />
                          </div>
                          {showCustomerList && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {filteredCustomers.length > 0 ? (
                                filteredCustomers.map(customer => (
                                  <button
                                    key={customer.customer_id}
                                    type="button"
                                    onClick={() => selectCustomer(customer)}
                                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                                  >
                                    <div className="font-medium text-slate-900">
                                      {customer.first_name} {customer.last_name}
                                    </div>
                                    <div className="text-xs text-slate-500 flex gap-3 mt-0.5">
                                      <span>{customer.contact_no || 'No phone'}</span>
                                      <span className="text-slate-300">|</span>
                                      <span>{customer.email_address || 'No email'}</span>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <div className="p-3 text-center">
                                  <p className="text-sm text-slate-500 mb-2">No existing customers found.</p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCustomerMode('new');
                                      const search = customerSearch.trim();
                                      if (search.includes('@')) {
                                        setWalkInData(prev => ({ ...prev, email_address: search }));
                                      } else {
                                        const parts = search.split(' ');
                                        if (parts.length === 1 && search.length > 0) {
                                          setWalkInData(prev => ({ ...prev, first_name: parts[0] }));
                                        } else if (parts.length > 1) {
                                          setWalkInData(prev => ({ ...prev, first_name: parts[0], last_name: parts.slice(1).join(' ') }));
                                        }
                                      }
                                    }}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#008A45] text-white text-sm font-semibold rounded-lg hover:bg-[#007038] transition-colors"
                                  >
                                    <UserPlus size={16} /> Create New Customer
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {!formData.customer_id && customerSearch === '' && (
                          <p className="text-xs text-slate-400 mt-1">Type to search for an existing customer, or switch to "Walk-in / New Customer" above.</p>
                        )}
                        {formData.customer_id && (
                          <p className="text-xs text-green-600 mt-1 font-medium">
                            ✅ Selected: {customers.find(c => c.customer_id === formData.customer_id)?.first_name} {customers.find(c => c.customer_id === formData.customer_id)?.last_name}
                          </p>
                        )}
                      </div>
                    )}

                    {customerMode === 'new' && (
                      <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-700">New Customer Details</p>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerMode('existing');
                              setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            Switch to Existing
                          </button>
                        </div>
                        <p className="text-xs text-amber-600 -mt-2">
                          ⚠️ Account will be created with a temporary password (password123). The customer can reset it via email.
                        </p>
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
                              required
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
                              required
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
                              placeholder="09123456789"
                              className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-[#008A45]"
                              required
                            />
                            <p className="text-[10px] text-slate-400 mt-0.5">Must be exactly 11 digits</p>
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
                              required
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
                  </div>
                )}
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

              {/* Pax, Motif Color, Total Amount (NO delivery fee) */}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motif Color</label>
                  {(() => {
                    const selectedPackage = packages.find(p => p.package_id === formData.package_id);
                    const packageColors = selectedPackage?.colors || [];
                    let colorOptions = [...packageColors];
                    if (formData.motif_color && !colorOptions.includes(formData.motif_color)) {
                      colorOptions.push(formData.motif_color);
                    }
                    return (
                      <>
                        {formData.package_id ? (
                          colorOptions.length > 0 ? (
                            <select
                              name="motif_color"
                              value={formData.motif_color}
                              onChange={handleInputChange}
                              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] bg-white"
                            >
                              <option value="">Select a color</option>
                              {colorOptions.map(color => (
                                <option key={color} value={color}>{color}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              name="motif_color"
                              value={formData.motif_color}
                              onChange={handleInputChange}
                              placeholder="No colors defined for this package. Type a color..."
                              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] bg-white"
                            />
                          )
                        ) : (
                          <input
                            type="text"
                            name="motif_color"
                            value={formData.motif_color}
                            onChange={handleInputChange}
                            placeholder="Select a package first to see available colors"
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] bg-slate-50"
                            disabled
                          />
                        )}
                        {formData.package_id && colorOptions.length > 0 && formData.motif_color && !packageColors.includes(formData.motif_color) && (
                          <p className="text-[10px] text-amber-600 mt-0.5">⚠️ Custom color – consider adding it to the package.</p>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="col-span-2">
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
                <button type="button" onClick={closeModal} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
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

      {/* APPROVAL MODAL – using hook */}
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

              <ApprovalAvailabilityCheck
                booking={approvalBooking}
                effectivePaxCount={(approvalBooking.pax_count || 0) + (approvalData.extraPax || 0)}
                onEquipmentStatusChange={setApprovalEquipmentStatus}
              />

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

              {approvalEquipmentStatus.applicable && !approvalEquipmentStatus.loading && !approvalEquipmentStatus.sufficient && (
                <p className="text-xs font-semibold text-red-600 text-right">
                  Can't approve — not enough {approvalEquipmentStatus.shortages.map(s => s.eqm_name).join(', ')} for this date.
                </p>
              )}

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
                  disabled={approveDisabled}
                  title={approveDisabled && !isApprovalSubmitting ? 'Not enough equipment for this date' : undefined}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isApprovalSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* REJECTION MODAL – using hook's state and handlers */}
      {isRejectionModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Rejection Reason</h2>
              <button onClick={() => setIsRejectionModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection</label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows="3"
                  placeholder="e.g., Incomplete details, client requested cancellation, etc."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
                <p className="text-xs text-slate-400 mt-1">Optional, but recommended.</p>
              </div>

              {showRejectionRefund && (
                <div className="border-t border-slate-200 pt-3 mt-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">
                    Process Refund <span className="font-normal text-slate-400">(optional – leave blank to skip)</span>
                  </p>
                  <p className="text-xs text-slate-500 mb-2">Max refundable: ₱{rejectionMaxRefundable.toLocaleString()}</p>
                  <p className="text-xs text-red-500 mb-2">* Proof of refund is required if you enter an amount.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rejectionRefundAmount}
                        onChange={(e) => setRejectionRefundAmount(e.target.value)}
                        placeholder="Enter amount (optional)"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
                      <input
                        type="text"
                        value={rejectionRefundRemarks}
                        onChange={(e) => setRejectionRefundRemarks(e.target.value)}
                        placeholder="Reason for refund"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-0.5">
                      Receipt / Proof of Refund <span className="text-red-500">*</span>
                      <span className="font-normal text-slate-400 ml-1">(required if amount entered)</span>
                    </label>
                    <label className="border-2 border-dashed border-slate-300 rounded-lg p-2 flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-center">
                      <input type="file" onChange={(e) => setRejectionRefundFile(e.target.files[0])} accept="image/*" className="hidden" />
                      <span className="text-xs text-slate-600">{rejectionRefundFile ? rejectionRefundFile.name : 'Upload Image (required for refund)'}</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsRejectionModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectConfirm}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm"
                >
                  Confirm Rejection
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