// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Clock, CheckCircle, TrendingUp, ChevronLeft, ChevronRight, RefreshCw, X, ArrowRight, Eye, Search } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { useApprovalHandlers } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import { isUnverifiedPayment, sumVerifiedPositivePayments, sumVerifiedDownpayments } from '../utils/payments';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange } from './Reports/helpers';

// `date.toISOString().split('T')[0]` converts to UTC before slicing the
// date portion — for any UTC+ timezone (PG's Catering is PHT, UTC+8),
// that silently shifts local midnight back onto the previous day. Used
// instead of that pattern everywhere this file needs a "YYYY-MM-DD" for
// date-range queries or comparisons, so "today"/"this month" actually
// mean today/this month in local time, not shifted by the UTC offset.
const toLocalDateStr = (d) => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayEvents: 0,
    pendingBookings: 0,
    upcomingEvents: 0,
    revenueThisMonth: 0,
  });
  const [todayEvents, setTodayEvents] = useState([]);
  const [pendingItems, setPendingItems] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarDays, setCalendarDays] = useState([]);
  const [eventDates, setEventDates] = useState({});

  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState([]);
  const [showDateModal, setShowDateModal] = useState(false);

  // --- Stats Detail Modal State ---
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [statsModalData, setStatsModalData] = useState([]);
  const [statsModalTitle, setStatsModalTitle] = useState('');
  const [statsModalType, setStatsModalType] = useState('');
  const [statsSearchTerm, setStatsSearchTerm] = useState('');
  const [statsTypeFilter, setStatsTypeFilter] = useState('All'); // 'All' | 'Package' | 'Short Order'
  const [statsMethodFilter, setStatsMethodFilter] = useState('All'); // revenue view only
  const [statsDatePreset, setStatsDatePreset] = useState('All Time');
  const [statsDateCustomStart, setStatsDateCustomStart] = useState('');
  const [statsDateCustomEnd, setStatsDateCustomEnd] = useState('');

  // --- Helper ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Fetch Dashboard Data ---
  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const todayStr = toLocalDateStr(today);
      const startOfMonthStr = toLocalDateStr(startOfMonth);
      const endOfMonthStr = toLocalDateStr(endOfMonth);

      // --- Calendar events (Package + Short Order — the calendar tracks
      // per-date what type(s) are on it, not just a count, so the day dot
      // can show which type the events actually are) ---
      const { data: monthBookings, error: monthError } = await supabase
        .from('booking')
        .select('event_datetime, booking_status, booking_type')
        .gte('event_datetime', `${startOfMonthStr} 00:00:00`)
        .lte('event_datetime', `${endOfMonthStr} 23:59:59`)
        .in('booking_status', ['Pending', ...ACTIVE_BOOKING_STATUSES]);

      if (monthError) throw monthError;

      const eventMap = {};
      (monthBookings || []).forEach(b => {
        if (b.event_datetime) {
          const date = toLocalDateStr(new Date(b.event_datetime));
          if (!eventMap[date]) eventMap[date] = { count: 0, hasPackage: false, hasShortOrder: false };
          eventMap[date].count++;
          if (b.booking_type === 'Short Order') {
            eventMap[date].hasShortOrder = true;
          } else {
            eventMap[date].hasPackage = true;
          }
        }
      });
      setEventDates(eventMap);

      // --- Today's Events (Package only) ---
      const { data: todayData, error: todayError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', ACTIVE_BOOKING_STATUSES)
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${todayStr} 23:59:59`)
        .order('event_datetime', { ascending: true });

      if (todayError) throw todayError;
      setTodayEvents(todayData || []);
      setStats(prev => ({ ...prev, todayEvents: todayData?.length || 0 }));

      // --- Pending Package Bookings (with package data) ---
      const { data: pendingPackages, error: pendingPackageError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          booking_type,
          total_amount,
          notes,
          customer:customer_id (first_name, last_name),
          package:package_id (pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax)
        `)
        .eq('booking_type', 'Package')
        .eq('booking_status', 'Pending')
        .order('event_datetime', { ascending: true });

      if (pendingPackageError) throw pendingPackageError;

      // --- Pending Short Orders ---
      const { data: pendingShortOrders, error: pendingShortError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          booking_type,
          total_amount,
          notes,
          delivery_fee,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Short Order')
        .eq('booking_status', 'Pending')
        .order('event_datetime', { ascending: true });

      if (pendingShortError) throw pendingShortError;

      // Combine and sort by event_datetime
      const combined = [...(pendingPackages || []), ...(pendingShortOrders || [])];
      combined.sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime));

      // Attach each item's payment totals so getPaymentSummary (used by the
      // Reject flow's refund-eligibility calc) has real numbers to read —
      // it used to be a hardcoded { positivePayments: 0, downpaymentPaid: 0 }
      // stub, which meant rejecting a Pending item with an existing verified
      // downpayment never warned about it and never allowed a refund amount.
      if (combined.length > 0) {
        const { data: pendingPayments, error: pendingPaymentsError } = await supabase
          .from('payment')
          .select('booking_id, amount_paid, pay_status')
          .in('booking_id', combined.map(b => b.booking_id));
        if (pendingPaymentsError) throw pendingPaymentsError;
        combined.forEach(item => {
          const itemPayments = (pendingPayments || []).filter(p => p.booking_id === item.booking_id);
          item.positivePayments = sumVerifiedPositivePayments(itemPayments);
          item.downpaymentPaid = sumVerifiedDownpayments(itemPayments);
        });
      }

      setPendingItems(combined);
      setStats(prev => ({ ...prev, pendingBookings: combined.length }));

      // --- Upcoming Events (Package only) ---
      const { data: upcomingData, error: upcomingError } = await supabase
        .from('booking')
        .select('booking_id')
        .eq('booking_type', 'Package')
        .in('booking_status', ACTIVE_BOOKING_STATUSES)
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${toLocalDateStr(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000))} 00:00:00`);

      if (upcomingError) throw upcomingError;
      setStats(prev => ({ ...prev, upcomingEvents: upcomingData?.length || 0 }));

      // --- Revenue This Month (verified payments only — Pending
      // Verification / Proof Rejected rows aren't real collected money
      // yet, matching sumVerifiedPositivePayments used everywhere else) ---
      const { data: revenueData, error: revenueError } = await supabase
        .from('payment')
        .select('amount_paid, pay_status')
        .gte('pay_datetime', `${startOfMonthStr} 00:00:00`)
        .lte('pay_datetime', `${endOfMonthStr} 23:59:59`);

      if (revenueError) throw revenueError;
      const totalRevenue = (revenueData || [])
        .filter(p => !isUnverifiedPayment(p))
        .reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      setStats(prev => ({ ...prev, revenueThisMonth: totalRevenue }));

    } catch (error) {
      handleError(error, 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  // --- Helper functions for hooks ---
  const getBooking = (bookingId) => {
    return pendingItems.find(item => item.booking_id === bookingId) || null;
  };

  const getPaymentSummary = (bookingId) => {
    const item = getBooking(bookingId);
    return item
      ? { positivePayments: item.positivePayments || 0, downpaymentPaid: item.downpaymentPaid || 0 }
      : { positivePayments: 0, downpaymentPaid: 0 };
  };

  // --- Approval & Rejection hooks ---
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
    fetchData: fetchDashboardData,
  });

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
    fetchData: fetchDashboardData,
  });

  // ... REST OF THE FILE REMAINS THE SAME (calendar, handlers, render) ...
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

  // --- Calendar generation ---
  useEffect(() => {
    generateCalendar(currentMonth);
  }, [currentMonth, eventDates]);

  const generateCalendar = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dayEvents = eventDates[dateStr];
      days.push({
        day: i,
        date: dateStr,
        hasEvent: !!dayEvents,
        hasPackage: !!dayEvents?.hasPackage,
        hasShortOrder: !!dayEvents?.hasShortOrder,
        isToday: dateStr === toLocalDateStr(new Date()),
      });
    }
    setCalendarDays(days);
  };

  const changeMonth = (delta) => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + delta);
    setCurrentMonth(newDate);
  };

  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  const fetchEventsForDate = async (dateStr) => {
    try {
      const { data, error } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          booking_type,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .in('booking_status', ['Pending', ...ACTIVE_BOOKING_STATUSES, 'Completed'])
        .gte('event_datetime', `${dateStr} 00:00:00`)
        .lt('event_datetime', `${dateStr} 23:59:59`)
        .order('event_datetime', { ascending: true });
      if (error) throw error;
      setSelectedDateEvents(data || []);
    } catch (error) {
      console.error('Error fetching events for date:', error);
      setSelectedDateEvents([]);
      toast.error('Failed to load events for this date.');
    }
  };

  const handleDayClick = (day) => {
    if (!day || !day.date) return;
    setSelectedDate(day.date);
    fetchEventsForDate(day.date);
    setShowDateModal(true);
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getClientName = (booking) => {
    if (booking.customer) {
      return `${booking.customer.first_name} ${booking.customer.last_name}`;
    }
    return 'Unknown Client';
  };

  const getVenueDisplay = (booking) => {
    if (booking.venue) return booking.venue;
    return 'No venue set';
  };

  const getBookingRef = (booking) => {
    if (booking.booking_number) return booking.booking_number;
    const prefix = booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
    return `${prefix}-${booking.booking_id.slice(0, 8)}`;
  };

  // --- Stats Card Click Handlers ---
  const handleTodayEventsClick = async () => {
    try {
      const today = new Date();
      const todayStr = toLocalDateStr(today);
      const { data, error } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', ACTIVE_BOOKING_STATUSES)
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${todayStr} 23:59:59`)
        .order('event_datetime', { ascending: true });
      if (error) throw error;
      setStatsModalData(data || []);
      setStatsModalTitle("Today's Events");
      setStatsModalType('today');
      resetStatsFilters();
      setIsStatsModalOpen(true);
    } catch (error) {
      handleError(error, 'Failed to load today\'s events.');
    }
  };

  const handlePendingBookingsClick = async () => {
    try {
      const { data, error } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          booking_type,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_status', 'Pending')
        .order('event_datetime', { ascending: true });
      if (error) throw error;
      setStatsModalData(data || []);
      setStatsModalTitle('Pending Orders (All Types)');
      setStatsModalType('pending');
      resetStatsFilters();
      setIsStatsModalOpen(true);
    } catch (error) {
      handleError(error, 'Failed to load pending orders.');
    }
  };

  const handleUpcomingEventsClick = async () => {
    try {
      const today = new Date();
      const todayStr = toLocalDateStr(today);
      const futureDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const futureStr = toLocalDateStr(futureDate);
      const { data, error } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          venue,
          pax_count,
          event_datetime,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', ACTIVE_BOOKING_STATUSES)
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${futureStr} 00:00:00`)
        .order('event_datetime', { ascending: true });
      if (error) throw error;
      setStatsModalData(data || []);
      setStatsModalTitle('Upcoming Events (7 days)');
      setStatsModalType('upcoming');
      resetStatsFilters();
      setIsStatsModalOpen(true);
    } catch (error) {
      handleError(error, 'Failed to load upcoming events.');
    }
  };

  const handleRevenueClick = async () => {
    try {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const startOfMonthStr = toLocalDateStr(startOfMonth);
      const endOfMonthStr = toLocalDateStr(endOfMonth);
      const { data, error } = await supabase
        .from('payment')
        .select(`
          payment_id,
          amount_paid,
          pay_datetime,
          pay_method,
          pay_status,
          booking:booking_id (
            booking_id,
            booking_number,
            booking_type,
            venue,
            customer:customer_id (first_name, last_name)
          )
        `)
        .gte('pay_datetime', `${startOfMonthStr} 00:00:00`)
        .lte('pay_datetime', `${endOfMonthStr} 23:59:59`)
        .order('pay_datetime', { ascending: false });
      if (error) throw error;
      // Match the card total: Pending Verification / Proof Rejected rows
      // aren't real collected money yet.
      setStatsModalData((data || []).filter(p => !isUnverifiedPayment(p)));
      setStatsModalTitle(`Net Collected This Month (${today.toLocaleString('default', { month: 'long', year: 'numeric' })})`);
      setStatsModalType('revenue');
      resetStatsFilters();
      setIsStatsModalOpen(true);
    } catch (error) {
      handleError(error, 'Failed to load revenue data.');
    }
  };

  const resetStatsFilters = () => {
    setStatsSearchTerm('');
    setStatsTypeFilter('All');
    setStatsMethodFilter('All');
    setStatsDatePreset('All Time');
    setStatsDateCustomStart('');
    setStatsDateCustomEnd('');
  };

  const closeStatsModal = () => {
    setIsStatsModalOpen(false);
    setStatsModalData([]);
    resetStatsFilters();
  };

  // --- Stats modal search/filter — same pattern as Payments.jsx's summary
  // modals, applied here so every card-click record list filters the same way.
  const { start: statsDateRangeStart, end: statsDateRangeEnd } = getRangeBounds(statsDatePreset, statsDateCustomStart, statsDateCustomEnd);

  const filteredStatsModalData = statsModalData.filter(item => {
    if (statsModalType === 'revenue') {
      const itemType = item.booking?.booking_type === 'Short Order' ? 'Short Order' : 'Package';
      if (statsTypeFilter !== 'All' && itemType !== statsTypeFilter) return false;
      if (statsMethodFilter !== 'All' && item.pay_method !== statsMethodFilter) return false;
      if (statsDatePreset !== 'All Time' && !isWithinRange(item.pay_datetime, statsDateRangeStart, statsDateRangeEnd)) return false;
      if (statsSearchTerm.trim()) {
        const term = statsSearchTerm.toLowerCase();
        const customerName = item.booking?.customer
          ? `${item.booking.customer.first_name} ${item.booking.customer.last_name}`.toLowerCase()
          : '';
        const ref = (item.booking?.booking_number || item.booking?.booking_id || '').toLowerCase();
        const venue = (item.booking?.venue || '').toLowerCase();
        if (!customerName.includes(term) && !ref.includes(term) && !venue.includes(term)) return false;
      }
      return true;
    }
    const itemType = item.booking_type === 'Short Order' ? 'Short Order' : 'Package';
    if (statsTypeFilter !== 'All' && itemType !== statsTypeFilter) return false;
    if (statsDatePreset !== 'All Time' && !isWithinRange(item.event_datetime, statsDateRangeStart, statsDateRangeEnd)) return false;
    if (statsSearchTerm.trim()) {
      const term = statsSearchTerm.toLowerCase();
      const customerName = getClientName(item).toLowerCase();
      const ref = getBookingRef(item).toLowerCase();
      const venue = (item.venue || '').toLowerCase();
      if (!customerName.includes(term) && !ref.includes(term) && !venue.includes(term)) return false;
    }
    return true;
  });
  const activeStatsFilterCount = (statsSearchTerm.trim() ? 1 : 0) + (statsTypeFilter !== 'All' ? 1 : 0) + (statsModalType === 'revenue' && statsMethodFilter !== 'All' ? 1 : 0) + (statsDatePreset !== 'All Time' ? 1 : 0);

  const handleStatsRowClick = (item) => {
    if (item.booking_id) {
      const route = item.booking_type === 'Short Order' ? '/app/orders' : '/app/bookings';
      navigate(`${route}/${item.booking_id}`);
    } else if (item.booking?.booking_id) {
      const route = item.booking.booking_type === 'Short Order' ? '/app/orders' : '/app/bookings';
      navigate(`${route}/${item.booking.booking_id}`);
    }
  };

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

  // --- RENDER ---
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Good Day, PG's Catering Owner!
          <span className="text-sm font-normal text-slate-500 block mt-1">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </h1>
        <button
          onClick={fetchDashboardData}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:border-[#008A45] hover:text-[#008A45] shadow-sm transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <div className="flex items-center gap-3 text-slate-500">
            <div className="w-6 h-6 border-2 border-[#008A45] border-t-transparent rounded-full animate-spin" />
            Loading dashboard...
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Today's Events */}
        <button
          onClick={handleTodayEventsClick}
          className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[#008A45]/40 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#008A45]" />
          <div className="w-11 h-11 rounded-full bg-[#008A45] flex items-center justify-center mb-3 shadow-sm">
            <CalendarIcon size={20} className="text-white" />
          </div>
          <span className="text-3xl font-extrabold text-slate-900 mb-1">{stats.todayEvents}</span>
          <span className="text-sm font-medium text-slate-600">Today's Events</span>
          <ArrowRight size={14} className="absolute top-3 right-3 text-[#008A45] opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to view</span>
        </button>

        {/* Pending Orders (combined) */}
        <button
          onClick={handlePendingBookingsClick}
          className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[#008A45]/40 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-600" />
          <div className="w-11 h-11 rounded-full bg-emerald-600 flex items-center justify-center mb-3 shadow-sm">
            <Clock size={20} className="text-white" />
          </div>
          <span className="text-3xl font-extrabold text-slate-900 mb-1">{stats.pendingBookings}</span>
          <span className="text-sm font-medium text-slate-600">Pending Orders</span>
          <span className="text-[10px] text-slate-400">(Packages + Short Orders)</span>
          <ArrowRight size={14} className="absolute top-3 right-3 text-[#008A45] opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to view</span>
        </button>

        {/* Upcoming Events */}
        <button
          onClick={handleUpcomingEventsClick}
          className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[#008A45]/40 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-600" />
          <div className="w-11 h-11 rounded-full bg-teal-600 flex items-center justify-center mb-3 shadow-sm">
            <CheckCircle size={20} className="text-white" />
          </div>
          <span className="text-3xl font-extrabold text-slate-900 mb-1">{stats.upcomingEvents}</span>
          <span className="text-sm font-medium text-slate-600">Upcoming Events (7 days)</span>
          <ArrowRight size={14} className="absolute top-3 right-3 text-[#008A45] opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to view</span>
        </button>

        {/* Net Collected This Month */}
        <button
          onClick={handleRevenueClick}
          className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[#008A45]/40 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#006634]" />
          <div className="w-11 h-11 rounded-full bg-[#006634] flex items-center justify-center mb-3 shadow-sm">
            <TrendingUp size={20} className="text-white" />
          </div>
          <span className="text-3xl font-extrabold text-slate-900 mb-1">
            ₱{stats.revenueThisMonth.toLocaleString()}
          </span>
          <span className="text-sm font-medium text-slate-600">Net Collected This Month</span>
          <ArrowRight size={14} className="absolute top-3 right-3 text-[#008A45] opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to view</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: Calendar & Today's Events */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="mb-6 border-b border-slate-200 pb-6">
            <div className="flex justify-between items-center mb-4 px-2">
              <button onClick={() => changeMonth(-1)} className="p-1.5 hover:bg-[#EAF3F2] hover:text-[#008A45] rounded-lg transition-colors">
                <ChevronLeft size={20} className="text-slate-600" />
              </button>
              <h3 className="font-bold text-slate-900 text-sm">{monthName}</h3>
              <button onClick={() => changeMonth(1)} className="p-1.5 hover:bg-[#EAF3F2] hover:text-[#008A45] rounded-lg transition-colors">
                <ChevronRight size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-4 text-center text-sm">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
                <div key={idx} className="text-slate-400 font-semibold text-xs">{day}</div>
              ))}
              {calendarDays.map((day, index) => (
                <div
                  key={index}
                  onClick={() => handleDayClick(day)}
                  className={`relative flex items-center justify-center font-medium text-sm cursor-pointer rounded-full w-7 h-7 mx-auto transition-colors
                    ${day?.isToday ? 'bg-[#008A45] text-white font-bold shadow-sm' : 'text-slate-900 hover:bg-[#EAF3F2] hover:text-[#008A45]'}
                  `}
                >
                  {day?.day}
                  {day?.hasEvent && (
                    <span className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 flex items-center gap-0.5">
                      {day.hasPackage && (
                        <span className={`w-1.5 h-1.5 rounded-full ${day.isToday ? 'bg-white' : 'bg-[#008A45]'}`}></span>
                      )}
                      {day.hasShortOrder && (
                        <span className={`w-1.5 h-1.5 rounded-full ${day.isToday ? 'bg-white/70' : 'bg-purple-500'}`}></span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4 mt-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-[#008A45]"></span> Package
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Short Order
              </span>
            </div>
          </div>

          <h3 className="font-bold text-slate-900 mb-4">Today's Events</h3>
          <div className="space-y-3">
            {todayEvents.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-4">No events scheduled for today.</p>
            ) : (
              todayEvents.map((event) => (
                <div
                  key={event.booking_id}
                  onClick={() => navigate(`/app/bookings/${event.booking_id}`)}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex justify-between items-center hover:border-[#008A45]/40 hover:bg-[#EAF3F2]/40 transition-colors cursor-pointer"
                >
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{getClientName(event)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{getVenueDisplay(event)} · {event.pax_count || 0} pax</p>
                  </div>
                  <span className="text-sm font-bold text-[#008A45]">{formatTime(event.event_datetime)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: Pending Orders (combined) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm h-fit">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">Pending Orders</h2>
            <button
              onClick={() => navigate('/app/bookings')}
              className="text-sm font-semibold text-[#008A45] underline decoration-2 underline-offset-4 hover:text-[#007038] transition-colors"
            >
              View All
            </button>
          </div>

          <div className="space-y-4">
            {pendingItems.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-8">No pending orders.</p>
            ) : (
              pendingItems.map((item) => {
                const isShortOrder = item.booking_type === 'Short Order';
                const detailPath = isShortOrder ? '/app/orders' : '/app/bookings';

                return (
                  <div key={item.booking_id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 hover:border-[#008A45]/30 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4
                            onClick={() => navigate(`${detailPath}/${item.booking_id}`)}
                            className="font-bold text-slate-900 text-sm cursor-pointer hover:text-[#008A45] transition-colors"
                          >
                            {getClientName(item)}
                          </h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isShortOrder ? 'bg-[#EAF3F2] text-[#008A45] border-[#C1DEDC]' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {isShortOrder ? 'Short Order' : 'Package'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(item.event_datetime)} · {item.venue || 'No venue'}
                          {!isShortOrder && ` · ${item.pax_count || 0} pax`}
                        </p>
                      </div>
                      <span className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1 rounded-full font-medium">
                        Pending
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => openApprovalModal(item, isShortOrder ? 'shortorder' : 'package')}
                        className="flex-1 bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm py-2 rounded-lg flex justify-center items-center gap-2 shadow-sm transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Approve
                      </button>
                      <button
                        onClick={() => openRejectionModal(item.booking_id)}
                        className="flex-1 bg-white border border-red-200 text-red-700 font-semibold text-sm py-2 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Reject
                      </button>
                      <button
                        onClick={() => navigate(`${detailPath}/${item.booking_id}`)}
                        className="flex-1 bg-white border border-slate-300 text-slate-800 font-semibold text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* DATE EVENTS MODAL */}
      {showDateModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 shrink-0">
              <h3 className="text-lg font-bold text-slate-900">
                Events on {selectedDate ? new Date(selectedDate).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}
              </h3>
              <button
                onClick={() => setShowDateModal(false)}
                className="text-slate-400 hover:text-slate-600 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {selectedDateEvents.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No events on this day.</p>
              ) : (
                <div className="space-y-3">
                  {selectedDateEvents.map(event => {
                    const isShortOrder = event.booking_type === 'Short Order';
                    return (
                      <div
                        key={event.booking_id}
                        onClick={() => {
                          setShowDateModal(false);
                          navigate(`${isShortOrder ? '/app/orders' : '/app/bookings'}/${event.booking_id}`);
                        }}
                        className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-slate-900 text-sm">{getClientName(event)}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isShortOrder ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                              {isShortOrder ? 'Short Order' : 'Package'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">{event.venue || 'No venue'} · {event.pax_count || 0} pax</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-slate-600">{formatTime(event.event_datetime)}</span>
                          <span className={`block text-xs font-medium ${event.booking_status === 'Approved' ? 'text-green-600' : event.booking_status === 'Confirmed' ? 'text-emerald-600' : event.booking_status === 'Completed' ? 'text-blue-600' : 'text-amber-600'}`}>
                            {event.booking_status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* STATS DETAIL MODAL */}
      {isStatsModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{statsModalTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{filteredStatsModalData.length} of {statsModalData.length} record(s) shown</p>
              </div>
              <button
                onClick={closeStatsModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {statsModalData.length > 0 && (
              <div className={`px-6 py-3 border-b space-y-2 shrink-0 ${activeStatsFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  {activeStatsFilterCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                      {activeStatsFilterCount} active
                    </span>
                  )}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search by client name, ref, or venue..."
                      value={statsSearchTerm}
                      onChange={(e) => setStatsSearchTerm(e.target.value)}
                      className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${statsSearchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                    />
                  </div>
                  <select
                    value={statsTypeFilter}
                    onChange={(e) => setStatsTypeFilter(e.target.value)}
                    className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${statsTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                  >
                    <option value="All">All types</option>
                    <option value="Package">Package</option>
                    <option value="Short Order">Short Order</option>
                  </select>
                  {statsModalType === 'revenue' && (
                    <select
                      value={statsMethodFilter}
                      onChange={(e) => setStatsMethodFilter(e.target.value)}
                      className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${statsMethodFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                    >
                      <option value="All">All methods</option>
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Refund">Refund</option>
                    </select>
                  )}
                  {activeStatsFilterCount > 0 && (
                    <button
                      onClick={resetStatsFilters}
                      className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <div className="flex flex-col items-start gap-1">
                  <p className="text-xs font-semibold text-slate-600">
                    Filter by {statsModalType === 'revenue' ? 'payment date' : 'event date'}:
                  </p>
                  <DateRangeFilter
                    preset={statsDatePreset}
                    customStart={statsDateCustomStart}
                    customEnd={statsDateCustomEnd}
                    rangeStart={statsDateRangeStart}
                    rangeEnd={statsDateRangeEnd}
                    onPresetChange={setStatsDatePreset}
                    onCustomStartChange={setStatsDateCustomStart}
                    onCustomEndChange={setStatsDateCustomEnd}
                    onClear={() => { setStatsDatePreset('All Time'); setStatsDateCustomStart(''); setStatsDateCustomEnd(''); }}
                  />
                </div>
              </div>
            )}

            <div className="p-6 overflow-y-auto flex-1">
              {statsModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records found for this category.</div>
              ) : filteredStatsModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records match your search/filter.</div>
              ) : (
                <>
                  {/* Today's Events / Pending / Upcoming - Booking list */}
                  {(statsModalType === 'today' || statsModalType === 'pending' || statsModalType === 'upcoming') && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Ref</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Venue</th>
                          <th className="p-3 text-center">Pax</th>
                          <th className="p-3">Event Date</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredStatsModalData.map((item) => {
                          const isShortOrder = item.booking_type === 'Short Order';
                          const detailPath = isShortOrder ? '/app/orders' : '/app/bookings';
                          return (
                            <tr
                              key={item.booking_id}
                              className="hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => navigate(`${detailPath}/${item.booking_id}`)}
                            >
                              <td className="p-3 font-mono text-xs font-semibold text-slate-800">
                                {getBookingRef(item)}
                              </td>
                              <td className="p-3 font-medium text-slate-900">{getClientName(item)}</td>
                              <td className="p-3">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isShortOrder ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                  {isShortOrder ? 'Short Order' : 'Package'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-600">{item.venue || 'N/A'}</td>
                              <td className="p-3 text-center font-semibold">{item.pax_count || 0}</td>
                              <td className="p-3 text-slate-600 text-xs">
                                {item.event_datetime ? new Date(item.event_datetime).toLocaleString() : 'N/A'}
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${getStatusBadge(item.booking_status)}`}>
                                  {item.booking_status}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`${detailPath}/${item.booking_id}`);
                                  }}
                                  className="text-[#008A45] hover:text-[#007038] transition-colors flex items-center gap-1 mx-auto text-xs font-medium"
                                >
                                  <Eye size={14} /> View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="8" className="p-3 text-right font-bold text-slate-700">
                            Total: {filteredStatsModalData.length} record(s)
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {/* Net Collected - Payment list */}
                  {statsModalType === 'revenue' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Booking Ref</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Venue</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3">Method</th>
                          <th className="p-3">Date</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredStatsModalData.map((payment) => {
                          const booking = payment.booking;
                          const customerName = booking?.customer
                            ? `${booking.customer.first_name} ${booking.customer.last_name}`
                            : 'Unknown';
                          const isShortOrder = booking?.booking_type === 'Short Order';
                          const detailPath = isShortOrder ? '/app/orders' : '/app/bookings';
                          return (
                            <tr
                              key={payment.payment_id}
                              className="hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => {
                                if (booking?.booking_id) {
                                  navigate(`${detailPath}/${booking.booking_id}`);
                                }
                              }}
                            >
                              <td className="p-3 font-mono text-xs font-semibold text-slate-800">
                                {booking?.booking_number || `BKG-${booking?.booking_id?.slice(0, 8) || 'N/A'}`}
                              </td>
                              <td className="p-3 font-medium text-slate-900">{customerName}</td>
                              <td className="p-3 text-slate-600">{booking?.venue || 'N/A'}</td>
                              <td className="p-3 text-right font-bold text-emerald-600">
                                ₱{payment.amount_paid?.toLocaleString() || 0}
                              </td>
                              <td className="p-3 text-slate-600">{payment.pay_method || 'N/A'}</td>
                              <td className="p-3 text-slate-600 text-xs">
                                {payment.pay_datetime ? new Date(payment.pay_datetime).toLocaleString() : 'N/A'}
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${payment.pay_status === 'Fully Paid' ? 'bg-green-100 text-green-700' : payment.pay_status === 'Downpayment' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {payment.pay_status || 'N/A'}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (booking?.booking_id) {
                                      navigate(`${detailPath}/${booking.booking_id}`);
                                    }
                                  }}
                                  className="text-[#008A45] hover:text-[#007038] transition-colors flex items-center gap-1 mx-auto text-xs font-medium"
                                >
                                  <Eye size={14} /> View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="3" className="p-3 text-right font-bold text-slate-700">Total Net Collected:</td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            ₱{filteredStatsModalData.reduce((sum, p) => sum + (p.amount_paid || 0), 0).toLocaleString()}
                          </td>
                          <td colSpan="4" className="p-3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={closeStatsModal}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== APPROVAL MODAL ===== */}
      {isApprovalModalOpen && approvalBooking && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">
                {approvalBooking.booking_type === 'Short Order' ? 'Approve Short Order – Adjust Fees' : 'Approve Booking – Adjust Fees'}
              </h2>
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
                  <span className="font-medium text-slate-600">Type:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.booking_type}</span>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.venue || 'N/A'}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalBooking.total_amount?.toLocaleString() || '0'}</span>
                </div>
                {approvalBooking.booking_type === 'Package' && (
                  <p className="text-xs text-slate-500 mt-2">* Adjust extra pax or add fees below.</p>
                )}
                {approvalBooking.booking_type === 'Short Order' && (
                  <p className="text-xs text-slate-500 mt-2">* Short order pricing is per tray. You can add extra fees below.</p>
                )}
              </div>

              <div className="space-y-4">
                {approvalBooking.booking_type === 'Package' ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                      <input
                        type="number"
                        name="extraQuantity"
                        min="0"
                        step="0.01"
                        value={approvalData.extraQuantity}
                        onChange={handleApprovalInputChange}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                        placeholder="e.g. 1000"
                      />
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
                      <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons)</label>
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
                  </>
                )}
              </div>

              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Down payment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">* Down payment is required to secure the order (non-refundable within 3 days of event).</p>
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
                  disabled={isApprovalSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isApprovalSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECTION REASON MODAL ===== */}
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
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection *</label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows="3"
                  placeholder="e.g., Incomplete details, client requested cancellation, etc."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">Reason is required.</p>
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