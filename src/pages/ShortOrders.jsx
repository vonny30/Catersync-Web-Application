// src/pages/ShortOrders.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Check, Edit, Trash2, ChevronLeft, ChevronRight,
  Filter, X, RefreshCw, RotateCcw, UserPlus, Plus, Users
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { createWalkInCustomer } from '../utils/createWalkInCustomer';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';

export default function ShortOrders() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();

  // --- STATE ---
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    customerId: '',
    venue: '',
    status: '',
  });
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [customerMode, setCustomerMode] = useState('existing');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    customer_id: '',
    booking_type: 'Short Order',
    event_datetime: '',
    venue: '',
    notes: '',
    total_amount: '0',
    delivery_fee: '0',
    menu_selections: [],
  });
  const [tempItem, setTempItem] = useState({ menu_item_id: '', quantity: 1 });
  const [walkInData, setWalkInData] = useState({
    first_name: '',
    last_name: '',
    contact_no: '',
    email_address: '',
    cus_address: '',
  });

  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [showCustomerList, setShowCustomerList] = useState(false);

  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- FETCH DATA ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('booking')
        .select('*, customer:customer_id (first_name, last_name, contact_no)', { count: 'exact' })
        .eq('booking_type', 'Short Order');

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

      if (filters.customerId) {
        query = query.eq('customer_id', filters.customerId);
      }
      if (filters.venue) {
        query = query.ilike('venue', `%${filters.venue}%`);
      }

      // --- SEARCH ---
      if (searchTerm) {
        const search = searchTerm.trim();
        if (search) {
          const parts = search.split(' ').filter(p => p.length > 0);
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
            query = query.eq('customer_id', '00000000-0000-0000-0000-000000000000');
          }
        }
      }

      query = query
        .order('status_order', { ascending: true })
        .order('is_read', { ascending: true })
        .order('book_datetime', { ascending: false })
        .range(from, to);

      const { data: ordersData, count, error: ordersError } = await query;
      if (ordersError) throw ordersError;

      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / pageSize));

      // Enrich with payment summaries
      if (ordersData && ordersData.length > 0) {
        const bookingIds = ordersData.map(b => b.booking_id);
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('payment')
          .select('booking_id, amount_paid, pay_status')
          .in('booking_id', bookingIds)
          .not('amount_paid', 'eq', 0)
          .not('pay_status', 'eq', 'Pending');
        if (paymentsError) throw paymentsError;

        const paymentMap = {};
        paymentsData.forEach(p => {
          if (!paymentMap[p.booking_id]) paymentMap[p.booking_id] = { positive: 0, refunded: 0, downpayment: 0 };
          const amount = parseFloat(p.amount_paid) || 0;
          if (amount > 0) {
            paymentMap[p.booking_id].positive += amount;
            if (p.pay_status === 'Downpayment') paymentMap[p.booking_id].downpayment += amount;
          } else if (amount < 0) {
            paymentMap[p.booking_id].refunded += Math.abs(amount);
          }
        });

        const now = new Date();
        const enriched = ordersData.map(order => {
          const p = paymentMap[order.booking_id] || { positive: 0, refunded: 0, downpayment: 0 };
          let refundStatus = null;
          if (order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') {
            const eventDate = order.event_datetime ? new Date(order.event_datetime) : null;
            let isRefundable = false;
            if (eventDate) {
              const diffTime = eventDate.getTime() - now.getTime();
              const daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              isRefundable = daysUntilEvent >= 3;
            }
            if (p.positive > 0) {
              if (p.refunded >= p.positive) {
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
          return { ...order, positivePayments: p.positive, totalRefunded: p.refunded, downpaymentPaid: p.downpayment, refundStatus };
        });
        setOrders(enriched);
      } else {
        setOrders(ordersData || []);
      }

      const { data: customersData, error: customersError } = await supabase
        .from('customer')
        .select('customer_id, first_name, last_name, contact_no, email_address')
        .eq('account_status', 'Active')
        .order('first_name');
      if (customersError) throw customersError;
      setCustomers(customersData || []);

      const { data: menuData, error: menuError } = await supabase
        .from('menu_item')
        .select('menu_item_id, menu_name, menu_price')
        .eq('menu_availability', 'Available')
        .order('menu_name');
      if (menuError) throw menuError;
      setMenuItems(menuData || []);

    } catch (error) {
      handleError(error, 'Unable to load short orders. Please refresh the page.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  // --- REACT HOOKS (top level) ---

  // 1. Approval Handler Hook
  const {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking: approvalOrder,
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

  // 2. Rejection Handler Hook with callbacks
  const getOrder = (id) => orders.find(o => o.booking_id === id);
  const getPaymentSummary = (id) => {
    const o = getOrder(id);
    return o ? { positivePayments: o.positivePayments, downpaymentPaid: o.downpaymentPaid } : { positivePayments: 0, downpaymentPaid: 0 };
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
    getBooking: getOrder,
    getPaymentSummary,
    fetchData,
  });

  // 3. Customer search filter for modal dropdown
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

  // 4. Fetch data when dependencies change
  useEffect(() => {
    fetchData();
  }, [currentPage, activeTab, searchTerm, filters]);

  // 5. ✅ REAL‑TIME SUBSCRIPTION (MUST be at top level, NOT inside fetchData)
  useEffect(() => {
    const subscription = supabase
      .channel('shortorder-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking',
          filter: `booking_type=eq.Short Order`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // --- SELECT CUSTOMER ---
  const selectCustomer = (customer) => {
    setFormData(prev => ({ ...prev, customer_id: customer.customer_id }));
    setCustomerSearch(`${customer.first_name} ${customer.last_name}`);
    setShowCustomerList(false);
  };

  // --- OPEN WALK-IN FROM SEARCH ---
  const openWalkInFromSearch = () => {
    setCustomerMode('new');
    setShowCustomerList(false);
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
  };

  // --- PAGINATION HANDLERS ---
  const goToPrevPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToNextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };

  // --- AUTO-CALCULATE TOTAL ---
  useEffect(() => {
    const total = formData.menu_selections.reduce((sum, sel) => {
      const item = menuItems.find(m => m.menu_item_id === sel.menu_item_id);
      return sum + (item ? item.menu_price * sel.quantity : 0);
    }, 0) + parseFloat(formData.delivery_fee || 0);
    setFormData(prev => ({ ...prev, total_amount: total.toFixed(2) }));
  }, [formData.menu_selections, formData.delivery_fee, menuItems]);

  // --- HANDLERS for create/edit modal ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleWalkInChange = (e) => {
    const { name, value } = e.target;
    setWalkInData(prev => ({ ...prev, [name]: value }));
  };

  const handleTempItemChange = (e) => {
    const { name, value } = e.target;
    setTempItem(prev => ({ ...prev, [name]: name === 'quantity' ? parseInt(value) || 0 : value }));
  };

  const addItemToSelection = () => {
    if (!tempItem.menu_item_id) {
      toast.error('Please select a menu item.');
      return;
    }
    const qty = parseInt(tempItem.quantity) || 0;
    if (qty < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = formData.menu_selections.find(item => item.menu_item_id === tempItem.menu_item_id);
    if (existing) {
      toast.error('This item is already added.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      menu_selections: [...prev.menu_selections, { menu_item_id: tempItem.menu_item_id, quantity: qty }],
    }));
    setTempItem({ menu_item_id: '', quantity: 1 });
  };

  const removeItemFromSelection = (menu_item_id) => {
    setFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.filter(item => item.menu_item_id !== menu_item_id),
    }));
  };

  const updateItemQuantity = (menu_item_id, quantity) => {
    if (quantity < 1) return;
    setFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.map(item =>
        item.menu_item_id === menu_item_id ? { ...item, quantity: parseInt(quantity) } : item
      ),
    }));
  };

  // --- OPEN/CLOSE MODAL ---
  const openNewModal = () => {
    setEditingId(null);
    setCustomerMode('existing');
    setCustomerSearch('');
    setShowCustomerList(false);
    setFormData({
      customer_id: '',
      booking_type: 'Short Order',
      event_datetime: '',
      venue: '',
      notes: '',
      total_amount: '0',
      delivery_fee: '0',
      menu_selections: [],
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsModalOpen(true);
  };

  const openEditModal = (order) => {
    setEditingId(order.booking_id);
    setCustomerMode('existing');
    setCustomerSearch('');
    setShowCustomerList(false);
    let selections = [];
    try {
      if (order.menu_selections) {
        if (typeof order.menu_selections === 'string') selections = JSON.parse(order.menu_selections);
        else if (Array.isArray(order.menu_selections)) selections = order.menu_selections;
      }
    } catch (e) { selections = []; }
    setFormData({
      customer_id: order.customer_id || '',
      booking_type: 'Short Order',
      event_datetime: order.event_datetime ? new Date(order.event_datetime).toISOString().slice(0, 16) : '',
      venue: order.venue || '',
      notes: order.notes || '',
      total_amount: order.total_amount?.toString() || '0',
      delivery_fee: order.delivery_fee?.toString() || '0',
      menu_selections: selections,
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setTempItem({ menu_item_id: '', quantity: 1 });
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
      booking_type: 'Short Order',
      event_datetime: '',
      venue: '',
      notes: '',
      total_amount: '0',
      delivery_fee: '0',
      menu_selections: [],
    });
    setWalkInData({ first_name: '', last_name: '', contact_no: '', email_address: '', cus_address: '' });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsSubmitting(false);
  };

  // --- FILTER MODAL ---
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
    setFilters({ dateFrom: '', dateTo: '', customerId: '', venue: '', status: '' });
    setCurrentPage(1);
  };

  // --- CRUD SUBMIT (Create/Edit) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const eventDateTimeISO = formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null;

    // --- CUSTOMER VALIDATION ---
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
        toast.error('Customer is required for this order.');
        setIsSubmitting(false);
        return;
      }
    }

    // Required fields
    if (formData.menu_selections.length === 0) {
      toast.error('Please add at least one menu item.');
      setIsSubmitting(false);
      return;
    }
    if (!formData.event_datetime) {
      toast.error('Please select an event date and time.');
      setIsSubmitting(false);
      return;
    }
    if (!formData.venue || formData.venue.trim() === '') {
      toast.error('Please enter a venue or delivery location.');
      setIsSubmitting(false);
      return;
    }

    // Event date proximity warning
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

      // If walk-in/new customer, create customer account first
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

      // ✅ DUPLICATE CHECK – only active bookings (not Rejected or Cancelled) on the same date
      const eventDate = new Date(formData.event_datetime);
      const startOfDay = new Date(eventDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(eventDate);
      endOfDay.setHours(23, 59, 59, 999);
      const startISO = startOfDay.toISOString();
      const endISO = endOfDay.toISOString();

      let dupQuery = supabase
        .from('booking')
        .select('booking_id, venue, event_datetime, booking_status')
        .eq('customer_id', customerId)
        .eq('booking_type', 'Short Order')
        .gte('event_datetime', startISO)
        .lte('event_datetime', endISO)
        .not('booking_status', 'in', '("Rejected","Cancelled")'); // ✅ exclude

      if (editingId) dupQuery = dupQuery.neq('booking_id', editingId);

      const { data: duplicates, error: dupError } = await dupQuery;
      if (dupError) console.error('Duplicate check error:', dupError);
      else if (duplicates && duplicates.length > 0) {
        const existing = duplicates[0];
        const { data: customerData } = await supabase
          .from('customer')
          .select('first_name, last_name')
          .eq('customer_id', customerId)
          .maybeSingle();
        const customerName = customerData ? `${customerData.first_name} ${customerData.last_name}` : 'Unknown Customer';
        const existingTime = existing.event_datetime
          ? new Date(existing.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Unknown Time';
        const venue = existing.venue || 'N/A';
        const status = existing.booking_status || 'Unknown';
        const count = duplicates.length;

        let message = `⚠️ Duplicate Booking Found\n\n`;
        if (count > 1) message += `Found ${count} bookings on this date. Showing the first one:\n\n`;
        message +=
          `Customer  : ${customerName}\n` +
          `Date      : ${new Date(eventDate).toLocaleDateString()}\n` +
          `Time      : ${existingTime}\n` +
          `Venue     : ${venue}\n` +
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

      // Build payload
      const payload = {
        customer_id: customerId,
        booking_type: 'Short Order',
        event_datetime: eventDateTimeISO,
        venue: formData.venue || null,
        pax_count: 0,
        notes: formData.notes || null,
        total_amount: parseFloat(formData.total_amount) || 0,
        delivery_fee: parseFloat(formData.delivery_fee) || 0,
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
        toast.success('Short order updated successfully!');
        closeModal();
        fetchData();
        setIsSubmitting(false);
        return;
      } else {
        const { data: newOrder, error } = await supabase
          .from('booking')
          .insert([payload])
          .select();
        if (error) throw error;
        const orderId = newOrder[0].booking_id;

        if (customerMode === 'new') await new Promise(resolve => setTimeout(resolve, 500));
        toast.success('Short order created successfully!');
        closeModal();
        fetchData();
      }
    } catch (error) {
      handleError(error, 'Failed to save short order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ❌ REMOVED local approval functions – now provided by the hook.
  // ❌ REMOVED local rejection functions – now provided by the hook.

  const handleMarkCompleted = async (id) => {
    const order = orders.find(o => o.booking_id === id);
    const confirmed = await showConfirm({
      title: 'Mark as Completed?',
      message: 'Are you sure you want to mark this order as completed?',
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

      if (order && order.positivePayments >= (order.total_amount || 0)) {
        const { error: updatePaymentsError } = await supabase
          .from('payment')
          .update({ pay_status: 'Fully Paid' })
          .eq('booking_id', id);
        if (updatePaymentsError) throw updatePaymentsError;
        toast.success('Order marked completed. All payments set to Fully Paid.');
      } else {
        toast.success('Order marked completed. Note: payments were left unchanged (balance remains).');
      }
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to update status.');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Order?',
      message: 'This will permanently delete this order and all associated payments. This action cannot be undone.',
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
      toast.success('Order deleted.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete order.');
    }
  };

  // --- BULK DELETE ---
  const toggleSelectOrder = (orderId) => {
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };
  const toggleSelectAll = () => {
    const visibleIds = filtered.map(o => o.booking_id);
    const allSelected = visibleIds.every(id => selectedOrders.includes(id));
    setSelectedOrders(allSelected ? [] : visibleIds);
  };
  const clearSelection = () => setSelectedOrders([]);

  const handleBulkDelete = async () => {
    if (selectedOrders.length === 0) return;
    const confirmed = await showConfirm({
      title: 'Delete Selected Orders?',
      message: `You are about to delete ${selectedOrders.length} order(s). This action cannot be undone and will also delete all associated payments.`,
      confirmLabel: 'Delete All',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    try {
      await supabase.from('payment').delete().in('booking_id', selectedOrders);
      const { error: ordersError } = await supabase
        .from('booking')
        .delete()
        .in('booking_id', selectedOrders);
      if (ordersError) throw ordersError;
      toast.success(`Successfully deleted ${selectedOrders.length} order(s).`);
      clearSelection();
      if (orders.length === selectedOrders.length && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        fetchData();
      }
    } catch (error) {
      handleError(error, 'Failed to delete selected orders.');
    }
  };

  // --- MARK AS READ (if is_read exists) ---
  const markAsRead = async (orderId) => {
    try {
      await supabase
        .from('booking')
        .update({ is_read: true })
        .eq('booking_id', orderId);
      fetchData();
    } catch (error) {
      console.warn('Failed to mark as read:', error);
    }
  };

  // --- FILTER LOGIC ---
  const tabs = ['All', 'Pending', 'Approved', 'Completed', 'Rejected', 'Cancelled'];

  const filtered = orders.filter(order => {
    if (activeTab !== 'All' && order.booking_status !== activeTab) return false;
    if (searchTerm) {
      const name = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.toLowerCase();
      const id = order.booking_id.toLowerCase();
      const search = searchTerm.toLowerCase();
      if (!name.includes(search) && !id.includes(search)) return false;
    }
    if (filters.dateFrom && order.event_datetime) {
      const eventDate = new Date(order.event_datetime);
      const fromDate = new Date(filters.dateFrom);
      fromDate.setHours(0,0,0,0);
      if (eventDate < fromDate) return false;
    }
    if (filters.dateTo && order.event_datetime) {
      const eventDate = new Date(order.event_datetime);
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23,59,59,999);
      if (eventDate > toDate) return false;
    }
    if (filters.customerId && order.customer_id !== filters.customerId) return false;
    if (filters.venue && order.venue) {
      const venueLower = order.venue.toLowerCase();
      const searchVenue = filters.venue.toLowerCase();
      if (!venueLower.includes(searchVenue)) return false;
    }
    return true;
  });

  const hasActiveFilters = filters.dateFrom || filters.dateTo || filters.customerId || filters.venue;

  const getStatusBadge = (status) => {
    const map = {
      Pending: 'bg-amber-50 border-amber-200 text-amber-700',
      Approved: 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800',
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

  // --- RENDER ---
  return (
    <div className="space-y-6 relative">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Short Orders</h1>
          <p className="text-sm text-slate-500">Manage food tray orders (pickup/delivery) – each tray serves 35‑50 pax</p>
        </div>
        <button
          onClick={openNewModal}
          className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm shadow-sm"
        >
          + New Short Order
        </button>
      </div>

      {/* TABS */}
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

      {/* SEARCH & FILTER */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by client name or order ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-slate-300 rounded-lg py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] bg-white"
          />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {selectedOrders.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm"
            >
              <Trash2 size={16} /> Delete Selected ({selectedOrders.length})
            </button>
          )}
          <button
            onClick={openFilterModal}
            className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 bg-white shadow-xs"
          >
            <Filter size={16} />
            Filter
            {hasActiveFilters && <span className="ml-1 w-2 h-2 rounded-full bg-[#008A45] inline-block" />}
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

      {/* TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(o => selectedOrders.includes(o.booking_id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                    disabled={filtered.length === 0}
                  />
                </th>
                <th className="p-4 font-bold min-w-[130px]">Client</th>
                <th className="p-4 font-bold min-w-[120px]">Created</th>
                <th className="p-4 font-bold min-w-[120px]">Event Date</th>
                <th className="p-4 font-bold min-w-[100px]">Venue</th>
                <th className="p-4 font-bold w-16 text-center">Trays</th>
                <th className="p-4 font-bold w-28 text-right">Amount</th>
                <th className="p-4 font-bold min-w-[120px] text-center">Status</th>
                <th className="p-4 font-bold min-w-[280px] text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading orders...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-500 italic">No short orders found.</td></tr>
              ) : (
                filtered.map((order) => {
                  let totalTrays = 0;
                  try {
                    let selections = order.menu_selections;
                    if (typeof selections === 'string') selections = JSON.parse(selections);
                    if (Array.isArray(selections)) {
                      totalTrays = selections.reduce((sum, s) => sum + (s.quantity || 0), 0);
                    }
                  } catch (e) { totalTrays = 0; }
                  return (
                    <tr
                      key={order.booking_id}
                      className={`hover:bg-slate-50 transition-colors ${!order.is_read ? 'font-bold' : ''}`}
                      onClick={() => { if (!order.is_read) markAsRead(order.booking_id); }}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedOrders.includes(order.booking_id)}
                          onChange={() => toggleSelectOrder(order.booking_id)}
                          className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <p
                            onClick={(e) => { e.stopPropagation(); navigate(`/app/orders/${order.booking_id}`); }}
                            className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-4 cursor-pointer hover:text-[#008A45]"
                          >
                            {order.customer?.first_name} {order.customer?.last_name}
                          </p>
                          {!order.is_read && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200 animate-pulse">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-slate-600 text-xs">
                        {order.book_datetime ? new Date(order.book_datetime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="p-4 text-slate-600 text-xs">
                        {order.event_datetime ? new Date(order.event_datetime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="p-4 font-medium">{order.venue || 'N/A'}</td>
                      <td className="p-4 text-center font-semibold">{totalTrays}</td>
                      <td className="p-4 font-bold text-slate-900 text-right">₱{order.total_amount?.toLocaleString() || '0'}</td>
                      <td className="p-4">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusBadge(order.booking_status)} inline-block w-[120px] text-center`}>
                            {order.booking_status}
                          </span>
                          {(order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') && order.refundStatus && (
                            <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getRefundStatusBadge(order.refundStatus)} inline-block w-[120px] text-center`}>
                              {order.refundStatus}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {order.booking_status === 'Pending' && (
                            <>
                              <button
                                onClick={() => openApprovalModal(order, 'shortorder')}
                                className="bg-[#C1DEDC] border border-[#a8cfcc] text-slate-800 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-[#b8dad7] transition-colors"
                              >
                                <Check size={14} /> Approve
                              </button>
                              <button
                                onClick={() => openRejectionModal(order.booking_id)}
                                className="bg-red-100 border border-red-200 text-red-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-200 transition-colors"
                              >
                                <X size={14} /> Reject
                              </button>
                            </>
                          )}
                          {order.booking_status === 'Approved' && (
                            <button
                              onClick={() => handleMarkCompleted(order.booking_id)}
                              className="bg-blue-100 border border-blue-200 text-blue-700 font-semibold text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-200 transition-colors"
                            >
                              <Check size={14} /> Complete
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/app/orders/${order.booking_id}`)}
                            className="bg-white border border-slate-300 text-slate-700 font-semibold text-[11px] px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => openEditModal(order)}
                            className="text-slate-400 hover:text-slate-700 transition-colors p-1"
                            title="Edit"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(order.booking_id)}
                            className="text-red-400 hover:text-red-600 transition-colors p-1"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-white text-sm text-slate-600">
          <span>Showing {orders.length} of {totalCount} orders</span>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevPage}
              disabled={currentPage === 1}
              className={`p-1 transition-colors ${currentPage === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-slate-800'}`}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-xs font-medium text-slate-600">Page {currentPage} of {totalPages}</span>
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

      {/* ===== NEW/EDIT ORDER MODAL ===== */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Short Order' : 'New Short Order'}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
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
                                    onClick={openWalkInFromSearch}
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

              {/* Event Date & Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time *</label>
                <input type="datetime-local" name="event_datetime" value={formData.event_datetime} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" required />
              </div>

              {/* Venue */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue / Location *</label>
                <input type="text" name="venue" value={formData.venue} onChange={handleInputChange} placeholder="e.g. Pick-up or Delivery address" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" required />
              </div>

              {/* Delivery Fee */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                <input type="number" name="delivery_fee" value={formData.delivery_fee} onChange={handleInputChange} placeholder="0.00" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              {/* Menu Items Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Menu Items (trays) *</label>
                <div className="flex gap-2 mb-2">
                  <select
                    name="menu_item_id"
                    value={tempItem.menu_item_id}
                    onChange={handleTempItemChange}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Choose item...</option>
                    {menuItems.map(item => (
                      <option key={item.menu_item_id} value={item.menu_item_id}>
                        {item.menu_name} (₱{item.menu_price} / tray)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={tempItem.quantity}
                    onChange={handleTempItemChange}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="#"
                  />
                  <button
                    type="button"
                    onClick={addItemToSelection}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 min-h-[80px] space-y-1.5 bg-slate-50">
                  {formData.menu_selections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No items added yet.</p>
                  ) : (
                    formData.menu_selections.map((item, idx) => {
                      const menuItem = menuItems.find(m => m.menu_item_id === item.menu_item_id);
                      const subtotal = menuItem ? menuItem.menu_price * item.quantity : 0;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {menuItem?.menu_name || 'Unknown'} × {item.quantity}
                            <span className="text-xs text-slate-500 ml-2">₱{subtotal.toFixed(2)}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateItemQuantity(item.menu_item_id, e.target.value)}
                              className="w-14 border border-slate-300 rounded p-0.5 text-sm text-center"
                            />
                            <button
                              type="button"
                              onClick={() => removeItemFromSelection(item.menu_item_id)}
                              className="text-red-500 hover:text-red-700 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Quantity = number of trays. Each tray serves 35‑50 pax.</p>
              </div>

              {/* Total Amount (editable) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
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
                <p className="text-xs text-slate-400 mt-1">Auto-calculated from menu items × quantity + delivery fee. You can adjust.</p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes (optional)</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" placeholder="Special instructions..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none" />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={closeModal} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== APPROVAL MODAL – Using the hook's state and handlers ===== */}
      {isApprovalModalOpen && approvalOrder && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Short Order – Adjust Fees</h2>
              <button onClick={() => setIsApprovalModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-left">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {approvalOrder.customer?.first_name} {approvalOrder.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{approvalOrder.venue || 'N/A'}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalOrder.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">Short order pricing is per tray. You can add extra fees below.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                  <input type="number" name="extraQuantity" min="0" step="0.01" value={approvalData.extraQuantity} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 1000" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                  <input type="number" name="extraDeliveryFee" min="0" step="0.01" value={approvalData.extraDeliveryFee} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons)</label>
                  <input type="number" name="additionalFee" min="0" step="0.01" value={approvalData.additionalFee} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 2000" />
                </div>
              </div>

              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Down payment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">* Down payment may be required for large orders (subject to business policy).</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsApprovalModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button onClick={handleFinalizeApproval} disabled={isApprovalSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {isApprovalSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECTION REASON MODAL (using hook's state and handlers) ===== */}
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

      {/* ===== FILTER MODAL ===== */}
      {isFilterModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Filter Short Orders</h2>
              <button onClick={closeFilterModal} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-left">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Event Date From</label>
                  <input type="date" name="dateFrom" value={filters.dateFrom} onChange={handleFilterChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Event Date To</label>
                  <input type="date" name="dateTo" value={filters.dateTo} onChange={handleFilterChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer</label>
                <select name="customerId" value={filters.customerId} onChange={handleFilterChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white">
                  <option value="">All Customers</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue (contains)</label>
                <input type="text" name="venue" value={filters.venue} onChange={handleFilterChange} placeholder="e.g. Grand Pavilion" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => { clearFilters(); closeFilterModal(); }} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Clear Filters</button>
                <button type="button" onClick={applyFilters} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors">Apply Filters</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}