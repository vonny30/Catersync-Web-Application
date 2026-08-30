// src/pages/ShortOrders.jsx
import { useState, useEffect, useRef } from 'react';
import Select from '../components/Select';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Check, Edit, Trash2, Lock, ChevronLeft, ChevronRight,
  Filter, X, RefreshCw, RotateCcw, UserPlus, Users,
  LayoutGrid, CalendarClock, Plus, Eye, Truck, AlertTriangle, Package as PackageIcon
} from 'lucide-react';
import { supabase } from '../supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { createWalkInCustomer } from '../utils/createWalkInCustomer';
import { getShortOrderFulfilment, PICKUP_VENUE_MARKER } from '../utils/vehicle';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';
import { errorInputClass } from '../utils/formErrors';
import DateTimePicker from '../components/DateTimePicker';
import { isPaymentLedgerLocked } from '../utils/payments';
import { bookingEditLockedMessage, MAX_SHORT_ORDERS_PER_DAY, STATUS_ORDER, findStatusOrderDrift } from '../utils/bookingStatus';
import { autoCompletePastEvents, hasUnpaidPastEvent } from '../utils/autoComplete';
import { getBookingsOnDate } from '../utils/availability';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds } from './Reports/helpers';

export default function ShortOrders() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrders, setSelectedOrders] = useState([]);

  // --- Scroll-to-table (status cards & quick looks jump straight to the
  // results). The scroll-to-top button itself is shared/global — see
  // ManagerLayout. ---
  const tableRef = useRef(null);
  const scrollToTable = () => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Ensures the status_order self-heal in fetchData runs at most once per
  // mount, so a repair that silently fails can't refetch in a loop.
  const statusOrderRepairedRef = useRef(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({
    customerId: '',
    venue: '',
  });
  const [datePreset, setDatePreset] = useState('All Time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Which date column the range filter above applies to — the event date
  // (when it happens) or the created/submitted date (when the order was
  // made). Defaults to event date, the original behavior.
  const [dateFilterField, setDateFilterField] = useState('event_datetime'); // 'event_datetime' | 'book_datetime'
  // Lightweight rows (status + event_datetime only) matching every filter
  // except status itself — powers the status cards and the Today/Upcoming
  // quick filters without re-fetching full order records per status.
  const [statusCountRows, setStatusCountRows] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [customerMode, setCustomerMode] = useState('existing');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Field-level errors for the New/Edit Order form — highlights exactly
  // which input is blocking submission (red border + inline message)
  // instead of only a toast.
  const [fieldErrors, setFieldErrors] = useState({});

  // Live count of other active Short Orders on the date currently picked
  // in the New/Edit form — informational here (the real block happens at
  // Approval), so staff can see the daily cap is coming up before they
  // even submit the order.
  const [dateOrderCount, setDateOrderCount] = useState(null);
  const [dateOrderCountLoading, setDateOrderCountLoading] = useState(false);

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
      const { start: dateStart, end: dateEnd } = getRangeBounds(datePreset, customStart, customEnd);

      // --- SEARCH: resolve once, reused by both the main query and the
      // status-count query below, so a search term narrows both. ---
      let searchCustomerIds = null;
      const search = searchTerm.trim();
      if (search) {
        const parts = search.split(' ').filter(p => p.length > 0);
        const conditions = [];
        parts.forEach(part => {
          conditions.push(`first_name.ilike.%${part}%`);
          conditions.push(`last_name.ilike.%${part}%`);
        });
        try {
          const { data: matchingCustomers } = await supabase
            .from('customer')
            .select('customer_id')
            .or(conditions.join(','));
          searchCustomerIds = (matchingCustomers || []).map(c => c.customer_id);
        } catch (e) {
          console.warn('Customer search failed:', e);
          searchCustomerIds = [];
        }
        if (searchCustomerIds.length === 0) searchCustomerIds = ['00000000-0000-0000-0000-000000000000'];
      }

      // Every filter except status and pagination — shared by the main
      // paginated query and the lightweight status-count query.
      const applyCommonFilters = (q) => {
        q = q.eq('booking_type', 'Short Order');
        if (dateStart) q = q.gte(dateFilterField, dateStart.toISOString());
        if (dateEnd) q = q.lte(dateFilterField, dateEnd.toISOString());
        if (filters.customerId) q = q.eq('customer_id', filters.customerId);
        if (filters.venue) q = q.ilike('venue', `%${filters.venue}%`);
        if (searchCustomerIds) q = q.in('customer_id', searchCustomerIds);
        return q;
      };

      let query = applyCommonFilters(
        supabase.from('booking').select('*, customer:customer_id (first_name, last_name, contact_no)', { count: 'exact' })
      );
      if (activeTab !== 'All') {
        query = query.eq('booking_status', activeTab);
      }

      // Unread ("NEW") orders float above read ones first — is_read is
      // false/true, and false sorts before true ascending, so new orders
      // land on top regardless of status. nullsFirst matters too: the NEW
      // badge below treats a null is_read the same as false, so the sort
      // has to agree, or an unset row would show "NEW" while sinking to
      // the bottom instead of floating up with the rest of the new ones.
      //
      // Everything below that still follows the existing rule: Pending ->
      // Approved -> Confirmed -> Completed -> Rejected -> Cancelled
      // (status_order encodes exactly this priority), then most-recently-
      // created first within each status group. That sequence is
      // unchanged — is_read is only an extra sort key ahead of it.
      query = query
        // Status is the PRIMARY grouping, is_read only breaks ties inside it —
        // see the matching note in Bookings.jsx. Reversed, it split every
        // status in two, so the same status appeared twice down the list.
        .order('status_order', { ascending: true })
        .order('is_read', { ascending: true, nullsFirst: true })
        .order('book_datetime', { ascending: false })
        .order('booking_id', { ascending: false })
        .range(from, to);

      const { data: ordersData, count, error: ordersError } = await query;
      if (ordersError) throw ordersError;

      // Self-heal rows whose status_order contradicts their status — same
      // reasoning as Bookings.jsx: nothing in the database keeps the two in
      // step, and the mobile app writes booking_status without knowing this
      // sort column exists. Only ever rewrites the derived value.
      const drift = findStatusOrderDrift(ordersData);
      if (drift.length > 0 && !statusOrderRepairedRef.current) {
        statusOrderRepairedRef.current = true;
        await Promise.all(drift.map(d =>
          supabase.from('booking').update({ status_order: d.status_order }).eq('booking_id', d.booking_id)
        ));
        console.info(`[status_order] repaired ${drift.length} row(s) whose sort key disagreed with booking_status`, drift);
        return fetchData();
      }

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
          const isUnverified = p.pay_status === 'Pending Verification' || p.pay_status === 'Proof Rejected';
          if (amount > 0 && !isUnverified) {
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

        // Passive auto-complete: no server-side cron in this stack, so this
        // runs whenever the list is loaded — any Confirmed order past its
        // event date and fully paid gets completed here.
        const completedIds = await autoCompletePastEvents(enriched);
        if (completedIds.length > 0) {
          fetchData();
        }
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

      // Lightweight status-count pass — same filters as above minus status
      // and pagination, fetching only the columns the cards/quick-filters
      // need, so it stays cheap even as the table grows.
      const { data: countRows, error: countRowsError } = await applyCommonFilters(
        supabase.from('booking').select('booking_id, booking_status, event_datetime')
      );
      if (countRowsError) throw countRowsError;
      setStatusCountRows(countRows || []);

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
    setApprovalVehicleIds,
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
  }, [currentPage, activeTab, searchTerm, filters, datePreset, customStart, customEnd, dateFilterField]);

  // Live count of other active Short Orders on the date picked in the
  // New/Edit form, so the daily cap is visible before submitting.
  useEffect(() => {
    let cancelled = false;
    if (!isModalOpen || !formData.event_datetime) {
      setDateOrderCount(null);
      return;
    }
    const run = async () => {
      setDateOrderCountLoading(true);
      try {
        const data = await getBookingsOnDate(formData.event_datetime, editingId, null, 'Short Order');
        if (!cancelled) setDateOrderCount(data.length);
      } catch (err) {
        console.error('Date order count check failed:', err);
        if (!cancelled) setDateOrderCount(null);
      } finally {
        if (!cancelled) setDateOrderCountLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isModalOpen, formData.event_datetime, editingId]);

  // Realtime refresh via the shared hook — see the matching note in
  // Bookings.jsx. The inline version captured fetchData from the first
  // render, so every event refetched page 1 while the manager was on a
  // later page.
  useRealtimeRefresh(
    'short-orders-page',
    [{ table: 'booking', filter: 'booking_type=eq.Short Order' }],
    fetchData
  );

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
  // Switching to pickup writes the marker and clears the fee, because a
  // collection is never charged for delivery. Switching back clears the marker
  // rather than leaving it as a half-edited address.
  const setFulfilment = (mode) => {
    setFormData(prev => ({
      ...prev,
      venue: mode === 'pickup' ? PICKUP_VENUE_MARKER : (prev.venue === PICKUP_VENUE_MARKER ? '' : prev.venue),
      delivery_fee: mode === 'pickup' ? '0' : prev.delivery_fee,
    }));
    setFieldErrors(prev => ({ ...prev, venue: undefined }));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleWalkInChange = (e) => {
    const { name, value } = e.target;
    setWalkInData(prev => ({ ...prev, [name]: value }));
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
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
    setFieldErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (order) => {
    if (isPaymentLedgerLocked(order.booking_status)) {
      toast.error(bookingEditLockedMessage(order.booking_status, { noun: 'order' }));
      return;
    }
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
    setFieldErrors({});
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
    setFieldErrors({});
    setIsSubmitting(false);
  };

  // --- FILTER MODAL ---
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setCurrentPage(1);
  };
  const clearFilters = () => {
    setFilters({ customerId: '', venue: '' });
    setDatePreset('All Time');
    setCustomStart('');
    setCustomEnd('');
    setDateFilterField('event_datetime');
    setSearchTerm('');
    setCurrentPage(1);
  };

  // "Today's Events" — every order happening today, any status, so a
  // manager can see the full day at a glance regardless of where each
  // order is in the pipeline.
  const applyTodayFilter = () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    setDatePreset('Custom');
    setCustomStart(todayISO);
    setCustomEnd(todayISO);
    setDateFilterField('event_datetime');
    setActiveTab('All');
    setCurrentPage(1);
    scrollToTable();
  };

  // "Upcoming Confirmed" — Confirmed orders from today onward (open-ended
  // end date), since those are the ones genuinely locked in and still to
  // come.
  const applyUpcomingConfirmedFilter = () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    setDatePreset('Custom');
    setCustomStart(todayISO);
    setCustomEnd('');
    setDateFilterField('event_datetime');
    setActiveTab('Confirmed');
    setCurrentPage(1);
    scrollToTable();
  };

  // --- CRUD SUBMIT (Create/Edit) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});

    if (editingId) {
      const targetStatus = orders.find(o => o.booking_id === editingId)?.booking_status;
      if (isPaymentLedgerLocked(targetStatus)) {
        toast.error(bookingEditLockedMessage(targetStatus, { noun: 'order' }));
        setIsSubmitting(false);
        return;
      }
    }

    const eventDateTimeISO = formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null;

    // --- CUSTOMER VALIDATION ---
    if (!editingId) {
      if (customerMode === 'existing' && !formData.customer_id) {
        toast.error('Please select an existing customer.');
        setFieldErrors({ customer_id: 'Please select an existing customer.' });
        setIsSubmitting(false);
        return;
      }

      if (customerMode === 'new') {
        if (!walkInData.first_name || !walkInData.last_name || !walkInData.contact_no || !walkInData.email_address) {
          toast.error('Please fill in all customer details for walk-in customer.');
          setFieldErrors({
            first_name: !walkInData.first_name ? 'Required.' : undefined,
            last_name: !walkInData.last_name ? 'Required.' : undefined,
            contact_no: !walkInData.contact_no ? 'Required.' : undefined,
            email_address: !walkInData.email_address ? 'Required.' : undefined,
          });
          setIsSubmitting(false);
          return;
        }
        if (!walkInData.email_address.includes('@')) {
          toast.error('Please enter a valid email address.');
          setFieldErrors({ email_address: 'Please enter a valid email address.' });
          setIsSubmitting(false);
          return;
        }
        const phoneRegex = /^[0-9]{11}$/;
        if (!phoneRegex.test(walkInData.contact_no)) {
          toast.error('Contact number must be 11 digits, numbers only.');
          setFieldErrors({ contact_no: 'Must be exactly 11 digits (numbers only).' });
          setIsSubmitting(false);
          return;
        }
      }
    } else {
      if (!formData.customer_id) {
        toast.error('Customer is required for this order.');
        setFieldErrors({ customer_id: 'Customer is required for this order.' });
        setIsSubmitting(false);
        return;
      }
    }

    // Required fields
    if (formData.menu_selections.length === 0) {
      toast.error('Please add at least one menu item.');
      setFieldErrors({ menu_selections: 'Add at least one menu item.' });
      setIsSubmitting(false);
      return;
    }
    if (!formData.event_datetime) {
      toast.error('Please select an event date and time.');
      setFieldErrors({ event_datetime: 'Please select an event date and time.' });
      setIsSubmitting(false);
      return;
    }
    if (!formData.venue || formData.venue.trim() === '') {
      toast.error('Please enter a venue or delivery location.');
      setFieldErrors({ venue: 'Please enter a venue or delivery location.' });
      setIsSubmitting(false);
      return;
    }
    if (!formData.total_amount || parseFloat(formData.total_amount) <= 0) {
      toast.error('Total amount must be greater than zero.');
      setFieldErrors({ total_amount: 'Must be greater than zero.' });
      setIsSubmitting(false);
      return;
    }

    // Event date proximity warning
    if (formData.event_datetime) {
      const eventDate = new Date(formData.event_datetime);
      const now = new Date();
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((eventDay - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        toast.error('The event date cannot be in the past. Please choose today or a later date.');
        setFieldErrors({ event_datetime: 'This date has already passed.' });
        setIsSubmitting(false);
        return;
      } else if (diffDays < 3) {
        // Hard block, not a soft warning — PG requires at least 3 days'
        // notice for any order. The date picker itself already refuses to
        // let a date this close be selected; this is the backstop in case
        // the field value was set some other way.
        toast.error('Orders must be placed at least 3 days before the event date — this is PG\'s catering policy.');
        setFieldErrors({ event_datetime: 'Must be at least 3 days from today.' });
        setIsSubmitting(false);
        return;
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

      // ✅ DUPLICATE CHECK – only active bookings (not Rejected or Cancelled)
      // on the same date. Skipped for a brand-new walk-in customer: they
      // were just created a few lines up, so they can't possibly already
      // have a booking on this date — and running the check (and letting
      // the manager Cancel out of it) would leave the account we just
      // created orphaned with no order attached to it.
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

          let message = `⚠️ Duplicate Order Found\n\n`;
          if (count > 1) message += `Found ${count} orders on this date. Showing the first one:\n\n`;
          message +=
            `Customer  : ${customerName}\n` +
            `Date      : ${new Date(eventDate).toLocaleDateString()}\n` +
            `Time      : ${existingTime}\n` +
            `Venue     : ${venue}\n` +
            `Status    : ${status}\n\n` +
            `Do you still want to proceed with this new order?`;

          const proceed = await showConfirm({
            title: '⚠️ Duplicate Order Detected',
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
        toast.success('Short order saved.');
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
        toast.success('Short order created.');
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

  // Approved -> Confirmed: manual step, requires at least 50% verified paid.
  const handleConfirmBooking = async (id) => {
    const order = orders.find(o => o.booking_id === id);
    if (!order) {
      toast.error('Order not found.');
      return;
    }
    const totalAmount = order.total_amount || 0;
    const paid = order.positivePayments || 0;
    const required = totalAmount * 0.5;
    if (paid < required) {
      toast.error(`Needs at least 50% paid and verified before this can be confirmed (₱${paid.toLocaleString()} of ₱${required.toLocaleString()} required).`);
      return;
    }
    const isFullyPaid = paid >= totalAmount;
    const confirmed = await showConfirm({
      title: 'Confirm This Order?',
      message: `This order has ${isFullyPaid ? 'been paid in full' : 'a verified downpayment of at least 50%'} (₱${paid.toLocaleString()} of ₱${totalAmount.toLocaleString()}). Marking it Confirmed locks the order in — cancellation only becomes available after this point. Continue?`,
      confirmLabel: 'Yes, Confirm Order',
      cancelLabel: 'Cancel',
      confirmVariant: 'success',
    });
    if (!confirmed) return;
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Confirmed', status_order: STATUS_ORDER.Confirmed, is_read: true })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Short order confirmed.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to confirm order.');
    }
  };

 const handleMarkCompleted = async (id) => {
  const order = orders.find(o => o.booking_id === id);
  if (!order) {
    toast.error('Order not found.');
    return;
  }

  const totalAmount = order.total_amount || 0;
  const totalPaid = order.positivePayments || 0;
  const remainingBalance = Math.max(0, totalAmount - totalPaid);
  const isFullyPaid = remainingBalance <= 0;

  if (!isFullyPaid) {
    toast.error(`Can't mark this order as completed — ₱${remainingBalance.toLocaleString()} is still owed. Full payment is required first.`);
    return;
  }

  const confirmed = await showConfirm({
    title: 'Mark as Completed?',
    message: 'Are you sure you want to mark this order as completed?\n\n✅ All payments are settled.',
    confirmLabel: 'Complete',
    confirmVariant: 'success',
  });
  if (!confirmed) return;

  try {
    // 1. Update booking status
    const { error } = await supabase
      .from('booking')
      .update({ booking_status: 'Completed', status_order: STATUS_ORDER.Completed, is_read: true })
      .eq('booking_id', id);
    if (error) throw error;

    // 2. Auto-complete all vehicle assignments for this booking
    const { error: vehicleReturnError } = await supabase
      .from('vehicle_assign')
      .update({ assignment_status: 'Completed' })
      .eq('booking_id', id);
    if (vehicleReturnError) throw vehicleReturnError;

    // 3. Update payments to Fully Paid
    if (totalPaid > 0) {
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Fully Paid' })
        .eq('booking_id', id);
      if (updatePaymentsError) throw updatePaymentsError;
    }
    toast.success('Short order completed. Remaining payments marked Fully Paid.');

    // 4. Refresh data
    fetchData();
  } catch (error) {
    handleError(error, 'Failed to complete order.');
  }
};

  const handleDelete = async (id) => {
    const targetOrder = orders.find(o => o.booking_id === id);
    const confirmed = await showConfirm({
      title: 'Delete Order?',
      message: `Are you sure you want to permanently delete this ${targetOrder?.booking_status || ''} order? This action cannot be undone. All associated payments and vehicle assignments will also be deleted.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this order is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;

      await supabase.from('vehicle_assign').delete().eq('booking_id', id);

      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Short order deleted.');
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
    const visibleIds = orders.map(o => o.booking_id);
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

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: `Deleting ${selectedOrders.length} order(s) is permanent. Re-enter your password to continue.`,
    });
    if (!passwordOk) return;

    try {
      await supabase.from('payment').delete().in('booking_id', selectedOrders);
      const { error: ordersError } = await supabase
        .from('booking')
        .delete()
        .in('booking_id', selectedOrders);
      if (ordersError) throw ordersError;
      toast.success(`Deleted ${selectedOrders.length} short order(s).`);
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

  // --- FILTER LOGIC (status/date/customer/venue/search all apply
  // server-side in fetchData; `orders` already reflects every active
  // filter for the current page) ---
  const STATUS_LIST = ['Pending', 'Approved', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'];
  const hasActiveFilters = datePreset !== 'All Time' || filters.customerId || filters.venue;
  const activeFilterCount = [!!searchTerm, datePreset !== 'All Time', !!filters.customerId, !!filters.venue].filter(Boolean).length;

  // The only status pill map on this page. Payments.jsx keeps a bordered
  // variant alongside its soft one because its modals put pills on coloured
  // surfaces; nothing here does, so there is one map rather than two.
  const getStatusBadgeSoft = (status) => ({
    Pending: 'bg-amber-50 text-amber-700',
    Approved: 'bg-[#EAF3F2] text-slate-800',
    Confirmed: 'bg-emerald-50 text-emerald-700',
    Completed: 'bg-blue-50 text-blue-700',
    Rejected: 'bg-red-50 text-red-700',
    Cancelled: 'bg-slate-100 text-slate-600',
  }[status] || 'bg-slate-100 text-slate-600');

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

  // --- STATUS CARDS + QUICK FILTERS (derived from statusCountRows, which
  // reflects every active filter except status/pagination) ---
  // Background colours, not border colours — the accent renders as its own
  // 3px element so it can be thinner than a Tailwind border-l step allows.
  const STATUS_CARD_BAR = {
    All: 'bg-slate-400',
    Pending: 'bg-amber-500',
    Approved: 'bg-[#008A45]',
    Confirmed: 'bg-emerald-500',
    Completed: 'bg-blue-500',
    Rejected: 'bg-red-500',
    Cancelled: 'bg-slate-400',
  };
  const STATUS_CARD_TEXT = {
    All: 'text-slate-900',
    Pending: 'text-amber-700',
    Approved: 'text-slate-900',
    Confirmed: 'text-emerald-700',
    Completed: 'text-blue-700',
    Rejected: 'text-red-700',
    Cancelled: 'text-slate-600',
  };
  const statusCards = ['All', ...STATUS_LIST].map(key => ({
    key,
    count: key === 'All' ? statusCountRows.length : statusCountRows.filter(r => r.booking_status === key).length,
  }));

  const todayStr = new Date().toDateString();
  const todaysEventsCount = statusCountRows.filter(r => r.event_datetime && new Date(r.event_datetime).toDateString() === todayStr).length;
  const upcomingConfirmedCount = statusCountRows.filter(r => r.booking_status === 'Confirmed' && r.event_datetime && new Date(r.event_datetime) >= new Date()).length;

  // --- RENDER ---
  return (
    <div className="space-y-[18px] relative">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Short Orders</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5">Manage food tray orders (pickup/delivery) – each tray serves 35‑50 pax</p>
        </div>
        <button
          onClick={openNewModal}
          className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm"
        >
          <Plus size={15} /> New Short Order
        </button>
      </div>

      {/* STATUS OVERVIEW + QUICK LOOKS */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <LayoutGrid size={13} className="text-slate-500" />
          <span className="text-[13px] font-bold text-slate-600 tracking-[0.04em] whitespace-nowrap">Status Overview</span>
        </div>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,132px),1fr))]">
          {statusCards.map((s) => (
            <button
              key={s.key}
              onClick={() => { setActiveTab(s.key); setCurrentPage(1); scrollToTable(); }}
              className={`text-left rounded-xl border border-slate-100 bg-[#fbfcfd] p-3.5 relative overflow-hidden transition-all ${
                activeTab === s.key ? 'ring-2 ring-[#008A45]/20 shadow-sm' : 'hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30'
              }`}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${STATUS_CARD_BAR[s.key]}`} />
              <p className="text-[13px] font-semibold text-slate-600 mb-1.5 whitespace-nowrap">{s.key === 'All' ? 'All Orders' : s.key}</p>
              <p className={`text-[23px] font-semibold tracking-[-0.02em] tabular-nums ${STATUS_CARD_TEXT[s.key]}`}>{s.count}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-slate-100">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-slate-600 tracking-[0.04em] whitespace-nowrap">
            <CalendarClock size={13} /> Quick filters
          </span>
          <button
            onClick={applyTodayFilter}
            className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 whitespace-nowrap hover:border-[#c9dfd4] hover:text-[#007038] transition-all"
          >
            Today's Events
            <span className="inline-flex items-center justify-center min-w-[21px] h-[21px] px-1.5 rounded-full bg-slate-100 text-slate-700 text-[12.5px] tabular-nums font-bold">{todaysEventsCount}</span>
          </button>
          <button
            onClick={applyUpcomingConfirmedFilter}
            className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 whitespace-nowrap hover:border-[#c9dfd4] hover:text-[#007038] transition-all"
          >
            Upcoming Confirmed
            <span className="inline-flex items-center justify-center min-w-[21px] h-[21px] px-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[12.5px] tabular-nums font-bold">{upcomingConfirmedCount}</span>
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className={`bg-white rounded-2xl border p-5 transition-colors ${activeFilterCount > 0 ? 'border-[#008A45]/30' : 'border-slate-200/70'}`}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-slate-500" />
            <span className="text-[13px] font-bold text-slate-600 tracking-[0.04em] whitespace-nowrap">Filters</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EAF3F2] text-[#007038] text-[10px] font-bold border border-[#008A45]/30">
                {activeFilterCount} active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(hasActiveFilters || searchTerm) && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <RotateCcw size={13} /> Clear all
              </button>
            )}
            {selectedOrders.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 text-xs shadow-sm"
              >
                <Trash2 size={14} /> Delete Selected ({selectedOrders.length})
              </button>
            )}
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <label className={`block text-[13px] font-semibold mb-1 ${searchTerm ? 'text-[#007038]' : 'text-slate-600'}`}>Search</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Customer name or reference"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className={`w-full border rounded-[10px] py-2.5 pl-4 pr-10 text-sm text-slate-800 outline-none transition-colors ${searchTerm ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'}`}
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            </div>
          </div>

          <div>
            <label className={`block text-[13px] font-semibold mb-1 ${filters.customerId ? 'text-[#007038]' : 'text-slate-600'}`}>Customer</label>
            <Select
              name="customerId"
              value={filters.customerId}
              onChange={handleFilterChange}
              className={`border rounded-[10px] px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors ${filters.customerId ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'}`}
            >
              <option value="">All Customers</option>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className={`block text-[13px] font-semibold mb-1 ${filters.venue ? 'text-[#007038]' : 'text-slate-600'}`}>Venue</label>
            <input
              type="text"
              name="venue"
              value={filters.venue}
              onChange={handleFilterChange}
              placeholder="e.g. Grand Pavilion"
              className={`border rounded-lg px-3 py-2.5 text-sm w-40 outline-none transition-colors ${filters.venue ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'}`}
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className={`text-[11px] font-semibold ${datePreset !== 'All Time' ? 'text-[#007038]' : 'text-slate-600'}`}>Filter by</label>
              <Select
                value={dateFilterField}
                onChange={(e) => { setDateFilterField(e.target.value); setCurrentPage(1); }}
                className={`text-[11px] font-semibold border rounded px-1 py-0.5 outline-none cursor-pointer ${datePreset !== 'All Time' ? 'text-[#007038] border-[#008A45]/40 bg-[#EAF3F2]' : 'text-slate-500 border-slate-300 bg-white'}`}
              >
                <option value="event_datetime">Event Date</option>
                <option value="book_datetime">Date Created</option>
              </Select>
            </div>
            <DateRangeFilter
              preset={datePreset}
              customStart={customStart}
              customEnd={customEnd}
              rangeStart={getRangeBounds(datePreset, customStart, customEnd).start}
              rangeEnd={getRangeBounds(datePreset, customStart, customEnd).end}
              onPresetChange={(p) => { setDatePreset(p); setCurrentPage(1); }}
              onCustomStartChange={(v) => { setCustomStart(v); setCurrentPage(1); }}
              onCustomEndChange={(v) => { setCustomEnd(v); setCurrentPage(1); }}
              onClear={() => { setDatePreset('All Time'); setCustomStart(''); setCustomEnd(''); setCurrentPage(1); }}
            />
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div ref={tableRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden scroll-mt-4">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-base tracking-[-0.01em] text-slate-900 flex justify-between items-center">
          <span>{activeTab === 'All' ? 'All Short Orders' : `${activeTab} Short Orders`}</span>
          <span className="text-sm font-normal text-slate-600 tabular-nums whitespace-nowrap">{totalCount} result{totalCount === 1 ? '' : 's'}</span>
        </div>
        {/* CARD LIST — below 2xl. See the matching note in Bookings.jsx: the
            table needs ~1500px and a 1440px laptop has ~1120px of content
            width, so it scrolled sideways on every screen short of a 1920px
            monitor. The table returns at 2xl where it genuinely fits. */}
        <div className="xl:hidden divide-y divide-slate-100">
          {loading ? (
            <p className="p-6 text-center text-slate-400 text-sm">Loading orders...</p>
          ) : orders.length === 0 ? (
            <p className="p-6 text-center text-slate-500 italic text-sm">No short orders found.</p>
          ) : (
            orders.map((order) => {
              let cardTrays = 0;
              try {
                let selections = order.menu_selections;
                if (typeof selections === 'string') selections = JSON.parse(selections);
                if (Array.isArray(selections)) {
                  cardTrays = selections.reduce((sum, sel) => sum + (sel.quantity || 0), 0);
                }
              } catch (e) { cardTrays = 0; }
              const cardFullyPaid = (order.positivePayments || 0) >= (order.total_amount || 0);
              const cardOwed = Math.max(0, (order.total_amount || 0) - (order.positivePayments || 0));
              return (
                <div
                  key={order.booking_id}
                  className={`p-4 transition-colors hover:bg-[#fbfcfd] ${!order.is_read ? 'bg-[#EAF3F2]/30' : ''}`}
                  onClick={() => { if (!order.is_read) markAsRead(order.booking_id); }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedOrders.includes(order.booking_id)}
                        onChange={() => toggleSelectOrder(order.booking_id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-4 h-4 shrink-0 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p
                            onClick={(e) => { e.stopPropagation(); navigate(`/app/orders/${order.booking_id}`); }}
                            className="text-[15px] font-semibold text-slate-900 cursor-pointer hover:text-[#008A45]"
                          >
                            {order.customer?.first_name} {order.customer?.last_name}
                          </p>
                          {!order.is_read && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#EAF3F2] text-[#00703a] text-[11px] font-bold tracking-[0.04em]">
                              NEW
                            </span>
                          )}
                        </div>
                        <p className="text-[13.5px] text-slate-500 mt-[3px] tabular-nums">
                          {order.event_datetime ? new Date(order.event_datetime).toLocaleDateString() : 'No date'}
                          {order.venue ? ` · ${order.venue}` : ''}
                          {cardTrays ? ` · ${cardTrays} tray${cardTrays === 1 ? '' : 's'}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="text-[15px] font-semibold text-slate-900 tabular-nums">
                        ₱{order.total_amount?.toLocaleString() || '0'}
                      </span>
                      <span className={`px-[11px] py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${getStatusBadgeSoft(order.booking_status)}`}>
                        {order.booking_status}
                      </span>
                      {hasUnpaidPastEvent(order) && (
                        <span className="px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap bg-red-50 text-red-700" title={`Event passed with ₱${cardOwed.toLocaleString()} still owed`}>
                          Past Due
                        </span>
                      )}
                      {(order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') && order.refundStatus && (
                        <span className={`px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${getRefundStatusBadge(order.refundStatus)}`}>
                          {order.refundStatus}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
                    {order.booking_status === 'Pending' && (
                      <>
                        <button onClick={() => openApprovalModal(order, 'shortorder')} className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors">
                          <Check size={13} /> Approve
                        </button>
                        <button onClick={() => openRejectionModal(order.booking_id)} className="bg-red-100 hover:bg-red-200 border border-red-200 text-red-700 font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors">
                          <X size={13} /> Reject
                        </button>
                      </>
                    )}
                    {order.booking_status === 'Approved' && (
                      <button onClick={() => handleConfirmBooking(order.booking_id)} className="bg-[#EAF3F2] hover:bg-[#ddeee5] border border-[#c9dfd4] text-[#00703a] font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors">
                        <Check size={13} /> Confirm
                      </button>
                    )}
                    {order.booking_status === 'Confirmed' && (
                      <button
                        onClick={() => handleMarkCompleted(order.booking_id)}
                        title={cardFullyPaid ? undefined : `Locked — ₱${cardOwed.toLocaleString()} still owed`}
                        className={`font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 border transition-colors ${cardFullyPaid ? 'bg-blue-50 hover:bg-blue-100 border-blue-100 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      >
                        {cardFullyPaid ? <Check size={13} /> : <Lock size={13} />} Complete
                      </button>
                    )}
                    <button onClick={() => navigate(`/app/orders/${order.booking_id}`)} className="bg-white border border-slate-200 text-slate-700 font-semibold text-[12.5px] px-3 py-[7px] rounded-[9px] hover:bg-slate-50 transition-colors">
                      Details
                    </button>
                    <button
                      onClick={() => openEditModal(order)}
                      title={isPaymentLedgerLocked(order.booking_status) ? bookingEditLockedMessage(order.booking_status, { noun: 'order' }) : 'Edit'}
                      className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border transition-colors ${isPaymentLedgerLocked(order.booking_status) ? 'border-slate-200 text-slate-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                      {isPaymentLedgerLocked(order.booking_status) ? <Lock size={14} /> : <Edit size={14} />}
                    </button>
                    <button onClick={() => handleDelete(order.booking_id)} title="Delete (password required)" className="flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-200 text-red-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden xl:block overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100">
                <th className="px-3 py-3 w-[3%]">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && orders.every(o => selectedOrders.includes(o.booking_id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                    disabled={orders.length === 0}
                  />
                </th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[16%] min-[1920px]:w-[18%]">Customer</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[11%] min-[1920px]:w-[9%]">Created</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[11%] min-[1920px]:w-[9%]">Event Date</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[12%] min-[1920px]:w-[14%]">Venue</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[5%] text-right">Trays</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[11%] min-[1920px]:w-[9%] text-right">Amount</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[10%] min-[1920px]:w-[12%]">Status</th>
                <th className="px-3 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-[21%] min-[1920px]:w-[23%] text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading orders...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-500 italic">No short orders found.</td></tr>
              ) : (
                orders.map((order) => {
                  let totalTrays = 0;
                  try {
                    let selections = order.menu_selections;
                    if (typeof selections === 'string') selections = JSON.parse(selections);
                    if (Array.isArray(selections)) {
                      totalTrays = selections.reduce((sum, s) => sum + (s.quantity || 0), 0);
                    }
                  } catch (e) { totalTrays = 0; }
                  // Hoisted: the Complete button and the Past Due pill both
                  // need these, and inlining them twice invited the two to
                  // disagree.
                  const orderFullyPaid = (order.positivePayments || 0) >= (order.total_amount || 0);
                  const orderOwed = Math.max(0, (order.total_amount || 0) - (order.positivePayments || 0));
                  return (
                    <tr
                      key={order.booking_id}
                      className={`hover:bg-[#fbfcfd] transition-colors ${!order.is_read ? 'font-bold' : ''}`}
                      onClick={() => { if (!order.is_read) markAsRead(order.booking_id); }}
                    >
                      <td className="px-3 py-[15px]" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedOrders.includes(order.booking_id)}
                          onChange={() => toggleSelectOrder(order.booking_id)}
                          className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                        />
                      </td>
                      <td className="px-3 py-[15px]">
                        <div className="flex items-center gap-2">
                          <p
                            onClick={(e) => { e.stopPropagation(); navigate(`/app/orders/${order.booking_id}`); }}
                            className="text-[15px] font-semibold text-slate-900 cursor-pointer hover:text-[#008A45]"
                          >
                            {order.customer?.first_name} {order.customer?.last_name}
                          </p>
                          {!order.is_read && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#EAF3F2] text-[#00703a] text-[11px] font-bold tracking-[0.04em]">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-[15px] text-sm text-slate-600 tabular-nums">
                        {order.book_datetime ? new Date(order.book_datetime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-3 py-[15px] text-sm font-medium text-slate-800 tabular-nums">
                        {order.event_datetime ? new Date(order.event_datetime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-3 py-[15px] text-sm text-slate-800 break-words" title={order.venue || 'N/A'}>
                        {order.venue || 'N/A'}
                        {(() => {
                          const f = getShortOrderFulfilment(order);
                          if (!f) return null;
                          const pickup = f.mode === 'Customer pickup';
                          return (
                            <span className="mt-1 flex flex-wrap items-center gap-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${
                                  pickup ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700'
                                }`}
                                title={f.basis}
                              >
                                {pickup ? <PackageIcon size={11} /> : <Truck size={11} />}
                                {pickup ? 'Pickup' : 'Delivery'}
                              </span>
                              {f.feeLooksWrong && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold bg-amber-50 text-amber-800 ring-1 ring-amber-300"
                                  title={f.feeLooksWrong}
                                >
                                  <AlertTriangle size={11} /> Check fee
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-[15px] text-sm text-slate-800 text-right tabular-nums">{totalTrays}</td>
                      <td className="px-3 py-[15px] text-[15px] font-semibold text-slate-900 text-right tabular-nums">₱{order.total_amount?.toLocaleString() || '0'}</td>
                      <td className="px-3 py-[15px]">
                        <div className="flex flex-col items-start gap-1.5">
                          <span className={`px-[11px] py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${getStatusBadgeSoft(order.booking_status)}`}>
                            {order.booking_status}
                          </span>
                          {order.booking_status === 'Completed' && order.positivePayments < (order.total_amount || 0) && (
                            <span className="px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap bg-amber-50 text-amber-700">
                              Balance Remaining
                            </span>
                          )}
                          {hasUnpaidPastEvent(order) && (
                            <span className="px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap bg-red-50 text-red-700" title={`Event passed with ₱${orderOwed.toLocaleString()} still owed`}>
                              Past Due
                            </span>
                          )}
                          {(order.booking_status === 'Rejected' || order.booking_status === 'Cancelled') && order.refundStatus && (
                            <span className={`px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${getRefundStatusBadge(order.refundStatus)}`}>
                              {order.refundStatus}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-[15px]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Fixed-width slot. It renders for Completed /
                              Rejected / Cancelled rows too, which have no
                              primary action — that reserved space is what
                              keeps Details at the same x on every row. */}
                          <div className="w-[66px] min-[1920px]:w-[204px] shrink-0 flex items-center justify-end gap-1.5">
                            {order.booking_status === 'Pending' && (
                              <>
                                <button
                                  onClick={() => openApprovalModal(order, 'shortorder')}
                                title="Approve"
                                  className="w-[30px] min-[1920px]:w-[106px] shrink-0 justify-center bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-[12.5px] px-0 min-[1920px]:px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                                >
                                  <Check size={13} /> <span className="hidden min-[1920px]:inline">Approve</span>
                                </button>
                                <button
                                  onClick={() => openRejectionModal(order.booking_id)}
                                title="Reject"
                                  className="w-[30px] min-[1920px]:w-[92px] shrink-0 justify-center bg-red-100 hover:bg-red-200 border border-red-200 text-red-700 font-semibold text-[12.5px] px-0 min-[1920px]:px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                                >
                                  <X size={13} /> <span className="hidden min-[1920px]:inline">Reject</span>
                                </button>
                              </>
                            )}
                            {order.booking_status === 'Approved' && (
                              <button
                                onClick={() => handleConfirmBooking(order.booking_id)}
                              title="Confirm"
                                className="w-[30px] min-[1920px]:w-[106px] shrink-0 justify-center bg-[#EAF3F2] hover:bg-[#ddeee5] border border-[#c9dfd4] text-[#00703a] font-semibold text-[12.5px] px-0 min-[1920px]:px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                              >
                                <Check size={13} /> <span className="hidden min-[1920px]:inline">Confirm</span>
                              </button>
                            )}
                            {order.booking_status === 'Confirmed' && (
                              <button
                                onClick={() => handleMarkCompleted(order.booking_id)}
                                title={orderFullyPaid ? 'Mark completed' : `Locked — ₱${orderOwed.toLocaleString()} still owed`}
                                className={`w-[30px] min-[1920px]:w-[106px] shrink-0 justify-center font-semibold text-[12.5px] px-0 min-[1920px]:px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 border transition-colors ${
                                  orderFullyPaid ? 'bg-blue-50 hover:bg-blue-100 border-blue-100 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'
                                }`}
                              >
                                {orderFullyPaid ? <Check size={13} /> : <Lock size={13} />} <span className="hidden min-[1920px]:inline">Complete</span>
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => navigate(`/app/orders/${order.booking_id}`)}
                            title="View details"
                            className="w-[30px] min-[1920px]:w-[78px] shrink-0 justify-center bg-white border border-slate-200 text-slate-700 font-semibold text-[12.5px] px-0 min-[1920px]:px-3 py-[7px] rounded-[9px] hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                          >
                            <Eye size={14} /><span className="hidden min-[1920px]:inline">Details</span>
                          </button>
                          <button
                            onClick={() => openEditModal(order)}
                            className={`flex items-center justify-center w-[30px] h-[30px] shrink-0 rounded-[9px] border transition-colors ${isPaymentLedgerLocked(order.booking_status) ? 'border-slate-200 text-slate-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                            title={isPaymentLedgerLocked(order.booking_status) ? bookingEditLockedMessage(order.booking_status, { noun: 'order' }) : 'Edit'}
                          >
                            {isPaymentLedgerLocked(order.booking_status) ? <Lock size={14} /> : <Edit size={14} />}
                          </button>
                          <button
                            onClick={() => handleDelete(order.booking_id)}
                            className="flex items-center justify-center w-[30px] h-[30px] shrink-0 rounded-[9px] border border-slate-200 text-red-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                            title="Delete (password required)"
                          >
                            <Trash2 size={14} />
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
        <div className="px-5 py-4 border-t border-slate-100 flex justify-between items-center bg-white text-sm text-slate-600">
          <span className="tabular-nums">Showing {orders.length} of {totalCount} orders</span>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevPage}
              disabled={currentPage === 1}
              className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-100 bg-white transition-colors ${currentPage === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-[13px] font-semibold tabular-nums text-slate-600">Page {currentPage} of {totalPages}</span>
            <button
              onClick={goToNextPage}
              disabled={currentPage === totalPages}
              className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-100 bg-white transition-colors ${currentPage === totalPages ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
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
                                setFieldErrors(prev => (prev.customer_id ? { ...prev, customer_id: undefined } : prev));
                              }}
                              onFocus={() => setShowCustomerList(true)}
                              placeholder="Search by name, phone, or email..."
                              className={errorInputClass(!!fieldErrors.customer_id, 'w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 outline-none bg-white')}
                            />
                          </div>
                          {fieldErrors.customer_id && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.customer_id}</p>}
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
                          ⚠️ Account will be created with the default password (Password123!). The customer can reset it via email.
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
                              className={errorInputClass(!!fieldErrors.first_name, 'w-full border rounded-lg p-2 text-sm outline-none')}
                              required
                            />
                            {fieldErrors.first_name && <p className="text-[10px] text-red-600 font-semibold mt-0.5">{fieldErrors.first_name}</p>}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-0.5">Last Name *</label>
                            <input
                              type="text"
                              name="last_name"
                              value={walkInData.last_name}
                              onChange={handleWalkInChange}
                              placeholder="e.g. Dela Cruz"
                              className={errorInputClass(!!fieldErrors.last_name, 'w-full border rounded-lg p-2 text-sm outline-none')}
                              required
                            />
                            {fieldErrors.last_name && <p className="text-[10px] text-red-600 font-semibold mt-0.5">{fieldErrors.last_name}</p>}
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
                              className={errorInputClass(!!fieldErrors.contact_no, 'w-full border rounded-lg p-2 text-sm outline-none')}
                              required
                            />
                            {fieldErrors.contact_no ? (
                              <p className="text-[10px] text-red-600 font-semibold mt-0.5">{fieldErrors.contact_no}</p>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-0.5">Must be exactly 11 digits</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-0.5">Email Address *</label>
                            <input
                              type="email"
                              name="email_address"
                              value={walkInData.email_address}
                              onChange={handleWalkInChange}
                              placeholder="e.g. juan@email.com"
                              className={errorInputClass(!!fieldErrors.email_address, 'w-full border rounded-lg p-2 text-sm outline-none')}
                              required
                            />
                            {fieldErrors.email_address && <p className="text-[10px] text-red-600 font-semibold mt-0.5">{fieldErrors.email_address}</p>}
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
                <DateTimePicker name="event_datetime" value={formData.event_datetime} onChange={handleInputChange} hasError={!!fieldErrors.event_datetime} minLeadDays={3} required />
                {fieldErrors.event_datetime && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.event_datetime}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Orders must be placed at least 3 days before the event — PG's catering policy.</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Only {MAX_SHORT_ORDERS_PER_DAY} Short Orders can be approved per day.
                  {formData.event_datetime && !dateOrderCountLoading && dateOrderCount !== null && (
                    dateOrderCount >= MAX_SHORT_ORDERS_PER_DAY ? (
                      <span className="text-red-600 font-bold"> This date is already full ({dateOrderCount}/{MAX_SHORT_ORDERS_PER_DAY}) — it can be submitted, but won't be approvable until a slot opens up.</span>
                    ) : (
                      <span className="text-emerald-600 font-semibold"> {dateOrderCount} of {MAX_SHORT_ORDERS_PER_DAY} already approved for this date.</span>
                    )
                  )}
                </p>
              </div>

              {/* Fulfilment — writes the SAME venue marker the customer app
                  writes, so an order taken over the counter is readable the
                  same way as one placed in the app. Typed freehand it would
                  not be: the marker has to match exactly to count as a pickup,
                  and a manager who writes "Main Branch" would have the system
                  send a van to fetch nothing. */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Fulfilment *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'pickup', label: 'Customer pickup', icon: PackageIcon, hint: 'Collected at the main branch' },
                    { key: 'delivery', label: 'Delivery', icon: Truck, hint: 'Delivered to an address' },
                  ].map(opt => {
                    const active = (formData.venue === PICKUP_VENUE_MARKER) === (opt.key === 'pickup');
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setFulfilment(opt.key)}
                        className={`flex flex-col items-start gap-0.5 border rounded-lg p-2.5 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20'
                            : 'border-slate-300 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className={`flex items-center gap-1.5 text-sm font-semibold ${active ? 'text-[#007038]' : 'text-slate-700'}`}>
                          <Icon size={14} /> {opt.label}
                        </span>
                        <span className="text-[11px] text-slate-500">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Venue — hidden for a pickup, because the marker IS the venue
                  and letting it be edited would break the match. */}
              {formData.venue !== PICKUP_VENUE_MARKER && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery address *</label>
                  <input type="text" name="venue" value={formData.venue} onChange={handleInputChange} placeholder="e.g. Banga, Bayawan City" className={errorInputClass(!!fieldErrors.venue, 'w-full border rounded-lg p-2.5 text-sm outline-none')} required />
                  {fieldErrors.venue && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.venue}</p>}
                  <p className="text-[11px] text-slate-500 mt-1">
                    PG&apos;s delivers free within Bayawan, Santa Catalina and Basay. A delivery fee applies outside those.
                  </p>
                </div>
              )}

              {/* Delivery Fee — not offered on a pickup at all. Nothing is
                  being delivered, so a fee here is a charge for a service that
                  does not happen; better to remove the option than to flag the
                  mistake afterwards. */}
              {formData.venue !== PICKUP_VENUE_MARKER && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                  <input type="number" name="delivery_fee" min="0" step="0.01" value={formData.delivery_fee} onChange={handleInputChange} placeholder="0.00" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
                </div>
              )}

              {/* Menu Items Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Menu Items (trays) *</label>
                {fieldErrors.menu_selections && <p className="text-xs text-red-600 font-semibold mb-1">{fieldErrors.menu_selections}</p>}
                <div className={`flex gap-2 mb-2 rounded-lg ${fieldErrors.menu_selections ? 'ring-1 ring-red-300' : ''}`}>
                  <Select
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
                  </Select>
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

              {/* Total Amount (auto-calculated) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (auto-calculated)</label>
                <input
                  type="number"
                  name="total_amount"
                  value={formData.total_amount}
                  placeholder="Auto-calculated"
                  step="0.01"
                  disabled
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-slate-100 text-slate-600"
                />
                <p className="text-xs text-slate-400 mt-1">Auto-calculated from menu items × quantity + delivery fee.</p>
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

              <ApprovalAvailabilityCheck
                onVehicleSelectionChange={setApprovalVehicleIds}
                booking={approvalOrder}
                effectivePaxCount={0}
              />

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                  <input type="number" name="extraQuantity" min="0" step="0.01" value={approvalData.extraQuantity} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 1000" />
                </div>
                {/* The other route to charging delivery on a collection.
                    Same reasoning as the create form: withhold the field
                    rather than flag the mistake later. */}
                {getShortOrderFulfilment(approvalOrder)?.mode !== 'Customer pickup' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                    <input type="number" name="extraDeliveryFee" min="0" step="0.01" value={approvalData.extraDeliveryFee} onChange={handleApprovalInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" placeholder="e.g. 500" />
                  </div>
                )}
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
                <p>Downpayment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">Downpayment may be required for large orders.</p>
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

    </div>
  );
}