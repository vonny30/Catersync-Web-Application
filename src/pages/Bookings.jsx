// src/pages/Bookings.jsx
import { useState, useEffect, useRef } from 'react';
import Select from '../components/Select';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Check, Edit, Trash2, Lock, ChevronLeft, ChevronRight,
  Filter, X, RefreshCw, RotateCcw, UserPlus, Image as ImageIcon, User, Users,
  LayoutGrid, CalendarClock, Plus
} from 'lucide-react';
import { supabase } from '../supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { checkEquipmentCapacityForDate, allocateEquipmentForBooking } from '../utils/equipment';
import { createWalkInCustomer } from '../utils/createWalkInCustomer';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';
import { errorInputClass } from '../utils/formErrors';
import DateTimePicker from '../components/DateTimePicker';
import { isPaymentLedgerLocked } from '../utils/payments';
import { bookingEditLockedMessage, STATUS_ORDER, findStatusOrderDrift } from '../utils/bookingStatus';
import { autoCompletePastEvents, hasUnpaidPastEvent } from '../utils/autoComplete';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds } from './Reports/helpers';

export default function Bookings() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBookings, setSelectedBookings] = useState([]);

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
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState({
    customerId: '',
    packageId: '',
    venue: '',
  });
  const [datePreset, setDatePreset] = useState('All Time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Which date column the range filter above applies to — the event date
  // (when it happens) or the created/submitted date (when the booking was
  // made). Defaults to event date, the original behavior.
  const [dateFilterField, setDateFilterField] = useState('event_datetime'); // 'event_datetime' | 'book_datetime'
  // Lightweight rows (status + event_datetime only) matching every filter
  // except status itself — powers the status cards and the Today/Upcoming
  // quick filters without re-fetching full booking records per status.
  const [statusCountRows, setStatusCountRows] = useState([]);

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
  // Field-level errors for the New/Edit Booking form — highlights exactly
  // which input is blocking submission (red border + inline message)
  // instead of only a toast.
  const [fieldErrors, setFieldErrors] = useState({});

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
        // No matches — force empty result rather than dropping the filter.
        if (searchCustomerIds.length === 0) searchCustomerIds = ['00000000-0000-0000-0000-000000000000'];
      }

      // Every filter except status and pagination — shared by the main
      // paginated query and the lightweight status-count query.
      const applyCommonFilters = (q) => {
        q = q.eq('booking_type', 'Package');
        if (dateStart) q = q.gte(dateFilterField, dateStart.toISOString());
        if (dateEnd) q = q.lte(dateFilterField, dateEnd.toISOString());
        if (filters.customerId) q = q.eq('customer_id', filters.customerId);
        if (filters.packageId) q = q.eq('package_id', filters.packageId);
        if (filters.venue) q = q.ilike('venue', `%${filters.venue}%`);
        if (searchCustomerIds) q = q.in('customer_id', searchCustomerIds);
        return q;
      };

      let query = applyCommonFilters(supabase.from('booking').select('*', { count: 'exact' }));
      if (activeTab !== 'All') {
        query = query.eq('booking_status', activeTab);
      }

      // Unread ("NEW") bookings float above read ones first — is_read is
      // false/true, and false sorts before true ascending, so new bookings
      // land on top regardless of status. Everything below that still
      // follows the existing rule: Pending -> Approved -> Confirmed ->
      // Completed -> Rejected -> Cancelled (status_order encodes exactly
      // this priority), then most-recently-created first within each
      // status group. That sequence is unchanged — is_read is only an
      // extra sort key ahead of it, not a replacement for it.
      // Status is the PRIMARY grouping, is_read only breaks ties inside it.
      //
      // These were the other way round, which split every status in two: an
      // unread Cancelled row sorted above a read Confirmed one, so the same
      // status appeared in two places down the list and the sequence read as
      // broken. New rows still get their emphasis — first within their own
      // status group, plus the NEW badge — without displacing the status
      // order the page is built around.
      //
      // nullsFirst matters here: the NEW badge treats a null is_read the same
      // as false (`!booking.is_read`), so the sort has to agree, or an unset
      // row would show "NEW" while sinking below the read ones in its group.
      query = query
        .order('status_order', { ascending: true })
        .order('is_read', { ascending: true, nullsFirst: true })
        .order('book_datetime', { ascending: false })
        .order('booking_id', { ascending: false })
        .range(from, to);

      const { data: bookingsData, count, error: bookingsError } = await query;
      if (bookingsError) throw bookingsError;

      // Self-heal rows whose status_order contradicts their status. Nothing
      // in the database keeps the two in step, and the customer mobile app
      // writes booking_status without knowing this sort column exists — so
      // left alone, those rows sort into the wrong status group and the list
      // looks scrambled. Repairing only ever rewrites a derived value to
      // match booking_status, which stays the authority.
      //
      // Guarded by a ref so a repair that doesn't take can't loop: at most
      // one repair-and-refetch per mount.
      const drift = findStatusOrderDrift(bookingsData);
      if (drift.length > 0 && !statusOrderRepairedRef.current) {
        statusOrderRepairedRef.current = true;
        await Promise.all(drift.map(d =>
          supabase.from('booking').update({ status_order: d.status_order }).eq('booking_id', d.booking_id)
        ));
        console.info(`[status_order] repaired ${drift.length} row(s) whose sort key disagreed with booking_status`, drift);
        return fetchData(); // re-read so the corrected rows land in the right group
      }

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

        // Passive auto-complete: no server-side cron in this stack, so this
        // runs whenever the list is loaded — any Confirmed booking past its
        // event date and fully paid gets completed here.
        const completedIds = await autoCompletePastEvents(enriched);
        if (completedIds.length > 0) {
          fetchData();
        }
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

      // Lightweight status-count pass — same filters as above minus status
      // and pagination, fetching only the columns the cards/quick-filters
      // need, so it stays cheap even as the table grows.
      const { data: countRows, error: countRowsError } = await applyCommonFilters(
        supabase.from('booking').select('booking_id, booking_status, event_datetime')
      );
      if (countRowsError) throw countRowsError;
      setStatusCountRows(countRows || []);

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
  }, [currentPage, activeTab, searchTerm, filters, datePreset, customStart, customEnd, dateFilterField]);

  const goToPrevPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToNextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };

  // Realtime refresh. Uses the shared hook rather than a hand-rolled
  // subscription because the inline version captured fetchData from the
  // FIRST render, when currentPage was 1 — every event then refetched page
  // 1 and replaced the list while the manager was on page 2, which looked
  // like paging jumping back to Pending. The hook keeps the callback in a
  // ref, so it always calls the current one. It was invisible until the
  // booking table was added to the supabase_realtime publication, because
  // before that the subscription never fired at all.
  useRealtimeRefresh(
    'bookings-page',
    [{ table: 'booking', filter: 'booking_type=eq.Package' }],
    fetchData
  );

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
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleWalkInChange = (e) => {
    const { name, value } = e.target;
    setWalkInData(prev => ({ ...prev, [name]: value }));
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
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
    setFieldErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (booking) => {
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(bookingEditLockedMessage(booking.booking_status));
      return;
    }
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
    setFieldErrors({});
    setIsSubmitting(false);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setCurrentPage(1);
  };
  const clearFilters = () => {
    setFilters({ customerId: '', packageId: '', venue: '' });
    setDatePreset('All Time');
    setCustomStart('');
    setCustomEnd('');
    setDateFilterField('event_datetime');
    setSearchTerm('');
    setCurrentPage(1);
  };

  // "Today's Events" — every event happening today, any status, so a
  // manager can see the full day at a glance regardless of where each
  // booking is in the pipeline.
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

  // "Upcoming Confirmed" — Confirmed events from today onward (open-ended
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

  // CRUD Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});

    if (editingId) {
      const targetStatus = bookings.find(b => b.booking_id === editingId)?.booking_status;
      if (isPaymentLedgerLocked(targetStatus)) {
        toast.error(bookingEditLockedMessage(targetStatus));
        setIsSubmitting(false);
        return;
      }
    }

    const eventDateTimeISO = formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null;

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
        toast.error('Customer is required for this booking.');
        setFieldErrors({ customer_id: 'Customer is required for this booking.' });
        setIsSubmitting(false);
        return;
      }
    }

    if (!formData.package_id) {
      toast.error('Please select a package for this booking.');
      setFieldErrors({ package_id: 'Please select a package for this booking.' });
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
      toast.error('Please enter a venue.');
      setFieldErrors({ venue: 'Please enter a venue.' });
      setIsSubmitting(false);
      return;
    }
    if (!formData.pax_count || parseInt(formData.pax_count) < 1) {
      toast.error('Enter the number of guests — at least 1.');
      setFieldErrors({ pax_count: 'Must be at least 1.' });
      setIsSubmitting(false);
      return;
    }
    if (!formData.total_amount || parseFloat(formData.total_amount) <= 0) {
      toast.error('Total amount must be greater than zero.');
      setFieldErrors({ total_amount: 'Must be greater than zero.' });
      setIsSubmitting(false);
      return;
    }

    const selectedPackage = packages.find(p => p.package_id === formData.package_id);
    if (selectedPackage && parseInt(formData.pax_count) < selectedPackage.minimum_pax) {
      const msg = `Minimum pax for this package is ${selectedPackage.minimum_pax}.`;
      toast.error(msg);
      setFieldErrors({ pax_count: msg });
      setIsSubmitting(false);
      return;
    }

    const requiredCategories = packageCategories.map(c => c.category_id);
    const selectedCategories = Object.keys(formData.menu_selections);
    const missing = requiredCategories.filter(c => !selectedCategories.includes(c));
    if (missing.length > 0) {
      toast.error('Please select a menu item for each category.');
      setFieldErrors({ menu_selections: 'Select a menu item for each category.' });
      setIsSubmitting(false);
      return;
    }

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
        // notice for any booking. The date picker itself already refuses to
        // let a date this close be selected; this is the backstop in case
        // the field value was set some other way.
        toast.error('Bookings must be made at least 3 days before the event date — this is PG\'s catering policy.');
        setFieldErrors({ event_datetime: 'Must be at least 3 days from today.' });
        setIsSubmitting(false);
        return;
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
        toast.success('Booking saved.');
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
        toast.success('Booking created.');
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
      message: `This booking has ${isFullyPaid ? 'been paid in full' : 'a verified downpayment of at least 50%'} (₱${paid.toLocaleString()} of ₱${totalAmount.toLocaleString()}). Marking it Confirmed locks the event in — cancellation only becomes available after this point. Equipment assignments will also be locked — no more adding, editing, or removing equipment after this. Continue?`,
      confirmLabel: 'Yes, Confirm Event',
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
      toast.success('Booking confirmed.');
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

  if (!isFullyPaid) {
    toast.error(`Can't mark this booking as completed — ₱${remainingBalance.toLocaleString()} is still owed. Full payment is required first.`);
    return;
  }

  const confirmed = await showConfirm({
    title: 'Mark as Completed?',
    message: 'Are you sure you want to mark this booking as completed?\n\n✅ All payments are settled.',
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

    // 4. Update payments to Fully Paid
    if (totalPaid > 0) {
      const { error: updatePaymentsError } = await supabase
        .from('payment')
        .update({ pay_status: 'Fully Paid' })
        .eq('booking_id', id);
      if (updatePaymentsError) throw updatePaymentsError;
    }
    toast.success('Booking completed. Remaining payments marked Fully Paid.');

    // 5. Refresh data
    fetchData();
  } catch (error) {
    handleError(error, 'Failed to complete booking.');
  }
};

  const handleDelete = async (id) => {
    const targetBooking = bookings.find(b => b.booking_id === id);
    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: `Are you sure you want to permanently delete this ${targetBooking?.booking_status || ''} booking? This action cannot be undone. All associated payments, equipment, and vehicle assignments will also be deleted.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this booking is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

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

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: `Deleting ${selectedBookings.length} booking(s) is permanent. Re-enter your password to continue.`,
    });
    if (!passwordOk) return;

    try {
      await supabase.from('payment').delete().in('booking_id', selectedBookings);
      await supabase.from('booking_equipment').delete().in('booking_id', selectedBookings);
      await supabase.from('vehicle_assign').delete().in('booking_id', selectedBookings);
      const { error: bookingsError } = await supabase
        .from('booking')
        .delete()
        .in('booking_id', selectedBookings);
      if (bookingsError) throw bookingsError;

      toast.success(`Deleted ${selectedBookings.length} booking(s).`);
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

  const STATUS_LIST = ['Pending', 'Approved', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'];
  const hasActiveFilters = datePreset !== 'All Time' || filters.customerId || filters.packageId || filters.venue;
  const activeFilterCount = [!!searchTerm, datePreset !== 'All Time', !!filters.customerId, !!filters.packageId, !!filters.venue].filter(Boolean).length;

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

  // Borderless variant for the table pills — the bordered map above is still
  // used where a pill sits on a coloured surface and needs the outline.
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

  return (
    <div className="space-y-[18px] relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Bookings</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5">Manage all client catering reservations (package bookings only)</p>
        </div>
        <button
          onClick={openNewBookingModal}
          className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm"
        >
          <Plus size={15} /> New Booking
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
              <p className="text-[13px] font-semibold text-slate-600 mb-1.5 whitespace-nowrap">{s.key === 'All' ? 'All Bookings' : s.key}</p>
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
            {selectedBookings.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 text-xs shadow-sm"
              >
                <Trash2 size={14} /> Delete Selected ({selectedBookings.length})
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
            <label className={`block text-[13px] font-semibold mb-1 ${filters.packageId ? 'text-[#007038]' : 'text-slate-600'}`}>Package</label>
            <Select
              name="packageId"
              value={filters.packageId}
              onChange={handleFilterChange}
              className={`border rounded-[10px] px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors ${filters.packageId ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'}`}
            >
              <option value="">All Packages</option>
              {packages.map(p => (
                <option key={p.package_id} value={p.package_id}>{p.pkg_name}</option>
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

      {/* Table */}
      <div ref={tableRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden scroll-mt-4">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-base tracking-[-0.01em] text-slate-900 flex justify-between items-center">
          <span>{activeTab === 'All' ? 'All Bookings' : `${activeTab} Bookings`}</span>
          <span className="text-sm font-normal text-slate-600 tabular-nums whitespace-nowrap">{totalCount} result{totalCount === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={bookings.length > 0 && bookings.every(b => selectedBookings.includes(b.booking_id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                    disabled={bookings.length === 0}
                  />
                </th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[130px]">Customer</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[120px]">Created</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[120px]">Event Date</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[100px]">Venue</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-16 text-right">Pax</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[110px]">Package</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap w-28 text-right">Amount</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[120px]">Status</th>
                <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700 whitespace-nowrap min-w-[200px] text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {loading ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-400">Loading bookings...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan="10" className="p-6 text-center text-slate-500 italic">No package bookings found.</td></tr>
              ) : (
                bookings.map((booking) => {
                  // Hoisted: the Complete button and the Past Due pill both
                  // need these, and inlining them twice invited the two to
                  // disagree.
                  const bookingFullyPaid = (booking.positivePayments || 0) >= (booking.total_amount || 0);
                  const bookingOwed = Math.max(0, (booking.total_amount || 0) - (booking.positivePayments || 0));
                  return (
                  <tr
                    key={booking.booking_id}
                    className={`hover:bg-[#fbfcfd] transition-colors ${!booking.is_read ? 'font-bold' : ''}`}
                    onClick={() => {
                      if (!booking.is_read) {
                        markAsRead(booking.booking_id);
                      }
                    }}
                  >
                    <td className="px-4 py-[15px]" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedBookings.includes(booking.booking_id)}
                        onChange={() => toggleSelectBooking(booking.booking_id)}
                        className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                      />
                    </td>
                    <td className="px-4 py-[15px]">
                      <div className="flex items-center gap-2">
                        <p
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/app/bookings/${booking.booking_id}`);
                          }}
                          className="text-[15px] font-semibold text-slate-900 cursor-pointer hover:text-[#008A45]"
                        >
                          {booking.customer?.first_name} {booking.customer?.last_name}
                        </p>
                        {!booking.is_read && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#EAF3F2] text-[#00703a] text-[11px] font-bold tracking-[0.04em]">
                            NEW
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-[15px] text-sm text-slate-600 tabular-nums">
                      {booking.book_datetime ? new Date(booking.book_datetime).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-4 py-[15px] text-sm font-medium text-slate-800 tabular-nums">
                      {booking.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-4 py-[15px] text-sm text-slate-800">{booking.venue || 'N/A'}</td>
                    <td className="px-4 py-[15px] text-sm text-slate-800 text-right tabular-nums">{booking.pax_count || 0}</td>
                    <td className="px-4 py-[15px] text-sm text-slate-800">{booking.package?.pkg_name || 'N/A'}</td>
                    <td className="px-4 py-[15px] text-[15px] font-semibold text-slate-900 text-right tabular-nums">₱{booking.total_amount?.toLocaleString() || '0'}</td>
                    <td className="px-4 py-[15px]">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className={`px-[11px] py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${getStatusBadgeSoft(booking.booking_status)}`}>
                          {booking.booking_status}
                        </span>
                        {booking.booking_status === 'Completed' && booking.positivePayments < (booking.total_amount || 0) && (
                          <span className="px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap bg-amber-50 text-amber-700">
                            Balance Remaining
                          </span>
                        )}
                        {hasUnpaidPastEvent(booking) && (
                          <span className="px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap bg-red-50 text-red-700" title={`Event passed with ₱${bookingOwed.toLocaleString()} still owed`}>
                            Past Due
                          </span>
                        )}
                        {(booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && booking.refundStatus && (
                          <span className={`px-[11px] py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${getRefundStatusBadge(booking.refundStatus)}`}>
                            {booking.refundStatus}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-[15px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Fixed-width slot. It renders for Completed /
                            Rejected / Cancelled rows too, which have no
                            primary action — that reserved space is what keeps
                            Details at the same x on every row. */}
                        <div className="w-[204px] shrink-0 flex items-center justify-end gap-1.5">
                          {booking.booking_status === 'Pending' && (
                            <>
                              <button
                                onClick={() => openApprovalModal(booking)}
                                className="w-[106px] shrink-0 justify-center bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                              >
                                <Check size={13} /> Approve
                              </button>
                              <button
                                onClick={() => openRejectionModal(booking.booking_id)}
                                className="w-[92px] shrink-0 justify-center bg-red-100 hover:bg-red-200 border border-red-200 text-red-700 font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                              >
                                <X size={13} /> Reject
                              </button>
                            </>
                          )}
                          {booking.booking_status === 'Approved' && (
                            <button
                              onClick={() => handleConfirmBooking(booking.booking_id)}
                              className="w-[106px] shrink-0 justify-center bg-[#EAF3F2] hover:bg-[#ddeee5] border border-[#c9dfd4] text-[#00703a] font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 transition-colors"
                            >
                              <Check size={13} /> Confirm
                            </button>
                          )}
                          {booking.booking_status === 'Confirmed' && (
                            <button
                              onClick={() => handleMarkCompleted(booking.booking_id)}
                              title={bookingFullyPaid ? undefined : `Locked — ₱${bookingOwed.toLocaleString()} still owed`}
                              className={`w-[106px] shrink-0 justify-center font-semibold text-[12.5px] px-[11px] py-[7px] rounded-[9px] flex items-center gap-1.5 border transition-colors ${
                                bookingFullyPaid ? 'bg-blue-50 hover:bg-blue-100 border-blue-100 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'
                              }`}
                            >
                              {bookingFullyPaid ? <Check size={13} /> : <Lock size={13} />} Complete
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                          className="w-[78px] shrink-0 text-center bg-white border border-slate-200 text-slate-700 font-semibold text-[12.5px] px-3 py-[7px] rounded-[9px] hover:bg-slate-50 transition-colors"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => openEditModal(booking)}
                          className={`flex items-center justify-center w-[30px] h-[30px] shrink-0 rounded-[9px] border transition-colors ${isPaymentLedgerLocked(booking.booking_status) ? 'border-slate-200 text-slate-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                          title={isPaymentLedgerLocked(booking.booking_status) ? bookingEditLockedMessage(booking.booking_status) : 'Edit'}
                        >
                          {isPaymentLedgerLocked(booking.booking_status) ? <Lock size={14} /> : <Edit size={14} />}
                        </button>
                        <button
                          onClick={() => handleDelete(booking.booking_id)}
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
          <span className="tabular-nums">Showing {bookings.length} of {totalCount} bookings</span>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevPage}
              disabled={currentPage === 1}
              className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-100 bg-white transition-colors ${currentPage === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-[13px] font-semibold tabular-nums text-slate-600">
              Page {currentPage} of {totalPages}
            </span>
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

              {/* Package */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Package *</label>
                <Select
                  name="package_id"
                  value={formData.package_id}
                  onChange={handleInputChange}
                  required
                  className={errorInputClass(!!fieldErrors.package_id, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                >
                  <option value="">Select Package</option>
                  {packages.map(p => (
                    <option key={p.package_id} value={p.package_id}>
                      {p.pkg_name} {p.pricing_type === 'fixed' ? '(Fixed)' : '(Per Pax)'}
                    </option>
                  ))}
                </Select>
                {fieldErrors.package_id && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.package_id}</p>}
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
                          <Select
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
                          </Select>
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
                <DateTimePicker
                  name="event_datetime"
                  value={formData.event_datetime}
                  onChange={handleInputChange}
                  hasError={!!fieldErrors.event_datetime}
                  minLeadDays={3}
                  required
                />
                {fieldErrors.event_datetime && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.event_datetime}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Bookings must be made at least 3 days before the event — PG's catering policy.</p>
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
                  className={errorInputClass(!!fieldErrors.venue, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                  required
                />
                {fieldErrors.venue && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.venue}</p>}
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
                    className={errorInputClass(!!fieldErrors.pax_count, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                    required
                  />
                  {fieldErrors.pax_count && <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.pax_count}</p>}
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
                            <Select
                              name="motif_color"
                              value={formData.motif_color}
                              onChange={handleInputChange}
                              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] bg-white"
                            >
                              <option value="">Select a color</option>
                              {colorOptions.map(color => (
                                <option key={color} value={color}>{color}</option>
                              ))}
                            </Select>
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (auto-calculated)</label>
                  <input
                    type="number"
                    name="total_amount"
                    value={formData.total_amount}
                    placeholder="Auto-calculated"
                    step="0.01"
                    disabled
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-slate-50 text-slate-600"
                  />
                  {fieldErrors.total_amount ? (
                    <p className="text-xs text-red-600 font-semibold mt-1">{fieldErrors.total_amount}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-1">Based on package pricing and pax count. Fees/discounts are applied when approving the booking.</p>
                  )}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Pax (additional guests)</label>
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
                <p>Downpayment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">Downpayment is required to secure the booking. Non-refundable within 3 days of the event.</p>
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

    </div>
  );
}