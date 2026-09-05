// src/pages/Dashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Clock, CheckCircle, TrendingUp, ChevronLeft, ChevronRight, RefreshCw, X, Eye, Search } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { useApprovalHandlers, extraPaxRate } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import { sumVerifiedPositivePayments, sumVerifiedDownpayments } from '../utils/payments';
import { getPaymentsReceived } from '../utils/reportMetrics';
import { fetchAllRows } from '../utils/fetchAllRows';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET } from './Reports/helpers';

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

// event_datetime and pay_datetime are `timestamp with time zone`. Comparing
// them against a naive string like "2026-08-01 00:00:00" makes Postgres read
// that string in the DATABASE's timezone — UTC on Supabase — while the string
// was built from a local calendar date here. In Manila that shifted every
// window eight hours late: payments in the first hours of a month fell outside
// it, and some from the following month fell inside.
//
// Sending an instant instead removes the ambiguity: toISOString() converts a
// local Date to the exact moment it represents, which is what a timestamptz
// comparison actually wants.
const startOfLocalDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addLocalDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Half-open [start, end) throughout. An inclusive "23:59:59" end both drops
// the final second and invites the rounding questions that come with it.
const instant = (d) => d.toISOString();

// The last day inside the "next 7 days" window: today + 6. The query runs
// .gte(today 00:00) .lt(today+7d 00:00), so the window INCLUDES today and
// covers today plus the following six days — which "7 days" alone left the
// manager to guess at.
const UPCOMING_WINDOW_DAYS = 7;

// Both ends of the window, written out. "Today through Aug 27" still asks the
// manager to know what today's date is before the range means anything; naming
// the first day as well makes the card readable on its own — and readable in a
// screenshot, where "today" is whatever day the screenshot was taken.
const upcomingWindowLabel = () => {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + UPCOMING_WINDOW_DAYS - 1);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d, withYear) => d.toLocaleDateString([], {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
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
    awaitingConfirmationThisMonth: 0,
    retainedThisMonth: 0,
  });
  const [todayEvents, setTodayEvents] = useState([]);
  const [pendingItems, setPendingItems] = useState([]);
  // Pinned to the 1st on purpose — see changeMonth for why the day
  // component of this date can never be allowed to drift above 28.
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
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
  const [statsDatePreset, setStatsDatePreset] = useState(DEFAULT_DATE_PRESET);
  const [statsDateCustomStart, setStatsDateCustomStart] = useState('');
  const [statsDateCustomEnd, setStatsDateCustomEnd] = useState('');

  // --- Helper ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Fetch Dashboard Data ---
  // --- Calendar events (Package + Short Order — the calendar tracks
  // per-date what type(s) are on it, not just a count, so the day dot can
  // show which type the events actually are) ---
  //
  // Deliberately separate from fetchDashboardData: that function always
  // scopes its month to `new Date()` (the real current month), so it was
  // the only source for eventDates — meaning navigating the calendar to
  // ANY other month (e.g. September while it's still August) never
  // fetched that month's events at all, so newly-added records for it
  // never showed up no matter how many existed. This instead fetches
  // whichever month is actually being VIEWED (see the effect below that
  // calls it whenever currentMonth changes).
  const fetchCalendarEvents = async (monthDate) => {
    try {
      // event_datetime is timestamptz — stored/compared in UTC. Sending a
      // naive string like "2026-08-24 00:00:00" gets interpreted as UTC
      // midnight by the database, not local midnight, so an event at
      // 8pm UTC (= 4am the NEXT day in the Philippines, UTC+8) was being
      // counted as "the 24th" by this query while the JS side below
      // buckets it by *local* date and puts it on the 25th — the exact
      // mismatch that let the 24th show no dot for an event that a click
      // still found, because fetchEventsForDate had the same bug.
      // `.toISOString()` on a Date built from local y/m/d converts local
      // midnight to the correct UTC instant, so both queries and the JS
      // bucketing below now agree on what day an event "actually" falls
      // on in the browser's timezone.
      const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const startOfNextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

      const { data: monthBookings, error: monthError } = await supabase
        .from('booking')
        .select('event_datetime, booking_type')
        .gte('event_datetime', startOfMonth.toISOString())
        .lt('event_datetime', startOfNextMonth.toISOString())
        .eq('booking_status', 'Confirmed');

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
    } catch (error) {
      handleError(error, 'Failed to load calendar events.');
    }
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      // Always the real current month — "Total Collections This Month" isn't
      // tied to whatever month the calendar happens to be showing.
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      // First moment of NEXT month, used as an exclusive upper bound.
      const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

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
        .gte('event_datetime', instant(startOfLocalDay(today)))
        .lt('event_datetime', instant(addLocalDays(today, 1)))
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
        .gte('event_datetime', instant(startOfLocalDay(today)))
        .lt('event_datetime', instant(addLocalDays(today, UPCOMING_WINDOW_DAYS)));

      if (upcomingError) throw upcomingError;
      setStats(prev => ({ ...prev, upcomingEvents: upcomingData?.length || 0 }));

      // --- Payments Received This Month ---
      // Anchored on pay_datetime and computed by utils/reportMetrics, the same
      // function the Payments page and Reports now use. The booking status comes
      // along so cash retained from a cancelled booking can be reported on its
      // own line instead of quietly inflating (or vanishing from) the headline.
      // Paged. A month's payments are not capped at anything, and PostgREST
      // truncates at 1000 rows WITHOUT an error — so past that the headline
      // collections figure would quietly under-report, growing more wrong as
      // the business grows. Ordered by primary key so paging cannot skip or
      // repeat rows.
      const revenueData = await fetchAllRows(
        () => supabase
          .from('payment')
          .select('amount_paid, pay_status, pay_datetime, booking:booking_id (booking_status)')
          .gte('pay_datetime', instant(startOfMonth))
          .lt('pay_datetime', instant(startOfNextMonth))
          .order('payment_id', { ascending: true }),
        'collections this month'
      );
      const received = getPaymentsReceived(revenueData);
      setStats(prev => ({
        ...prev,
        // Panel PR-38: only Confirmed and Completed bookings count as revenue.
        // The other two figures are reported beside it rather than folded in
        // or dropped — see REVENUE_BOOKING_STATUSES in utils/reportMetrics.
        revenueThisMonth: received.revenueReceived,
        awaitingConfirmationThisMonth: received.awaitingConfirmation,
        retainedThisMonth: received.retainedFromCancellations,
      }));

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
  //
  // The 60s polls these two effects used to run are replaced by realtime
  // below: polling meant a change could sit invisible for up to a minute,
  // and it refetched constantly even when nothing had happened. A long
  // interval is kept as a safety net so the dashboard still self-corrects
  // if the websocket drops (a laptop waking from sleep, flaky wifi) —
  // realtime delivers nothing while disconnected, and this page is the one
  // most likely to be left open unattended.
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 5 * 60000);
    return () => clearInterval(interval);
  }, []);

  useRealtimeRefresh('dashboard-page', ['booking', 'payment'], fetchDashboardData);

  // Refetches the calendar's event dots whenever the viewed month changes
  // (prev/next arrows), not just once for whatever month happened to be
  // current when the page loaded.
  useEffect(() => {
    fetchCalendarEvents(currentMonth);
  }, [currentMonth]);

  // Bookings changing status is exactly what adds or removes a calendar
  // dot (only Confirmed ones show), so the calendar has to react to the
  // same events the rest of the dashboard does.
  useRealtimeRefresh(
    'dashboard-calendar',
    ['booking'],
    useCallback(() => fetchCalendarEvents(currentMonth), [currentMonth])
  );

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

  // Bug: `new Date(currentMonth); newDate.setMonth(...)` mutates the month
  // while keeping whatever day-of-month currentMonth already had. If that
  // day was 29-31 (e.g. viewing "Jan 31" and clicking next), setMonth
  // rolls over into the following month instead — "Jan 31" + 1 month
  // becomes "Mar 3", silently skipping February. Building a fresh date
  // from year/month + a fixed day 1 sidesteps the rollover entirely.
  const changeMonth = (delta) => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  const fetchEventsForDate = async (dateStr) => {
    try {
      // Same timezone fix as fetchCalendarEvents above: `dateStr` is a
      // *local* calendar date (e.g. "2026-08-24"), but event_datetime is
      // timestamptz. Passing naive "2026-08-24 00:00:00" strings had the
      // database treat them as UTC midnight rather than local midnight —
      // off by the browser's UTC offset (8 hours in the Philippines) from
      // the actual local day boundary, and disagreeing with how the
      // calendar's own dots bucket the same event by local date.
      // `dayStart`/`dayEnd` are built as local Dates first (the `T00:00:00`
      // suffix with no offset is parsed as local time), then converted to
      // the correct UTC instant via `.toISOString()`.
      const dayStart = new Date(`${dateStr}T00:00:00`);
      const dayEnd = new Date(`${dateStr}T00:00:00`);
      dayEnd.setDate(dayEnd.getDate() + 1);
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
        .eq('booking_status', 'Confirmed')
        .gte('event_datetime', dayStart.toISOString())
        .lt('event_datetime', dayEnd.toISOString())
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
    return 'Unknown customer';
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
        .gte('event_datetime', instant(startOfLocalDay(today)))
        .lt('event_datetime', instant(addLocalDays(today, 1)))
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
      setStatsModalTitle('Pending Bookings & Orders');
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
        .gte('event_datetime', instant(startOfLocalDay(today)))
        .lt('event_datetime', instant(addLocalDays(today, UPCOMING_WINDOW_DAYS)))
        .order('event_datetime', { ascending: true });
      if (error) throw error;
      setStatsModalData(data || []);
      setStatsModalTitle(`Events in the next 7 days · ${upcomingWindowLabel()}`);
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
      // First moment of NEXT month, used as an exclusive upper bound.
      const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      // Paged for the same reason as the card. It matters more here: this
      // modal exists to reconcile with the figure that was clicked, and a
      // truncated list would disagree with a card that had itself been fixed.
      const data = await fetchAllRows(
        () => supabase
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
              booking_status,
              venue,
              customer:customer_id (first_name, last_name)
            )
          `)
          .gte('pay_datetime', instant(startOfMonth))
          .lt('pay_datetime', instant(startOfNextMonth))
          .order('pay_datetime', { ascending: false })
          .order('payment_id', { ascending: false }),
        'collections modal'
      );
      // List exactly the rows the card counted, so the modal's own total
      // reconciles with the figure that was clicked. Cash awaiting confirmation
      // and cash retained from cancelled bookings are reported on the card's
      // own lines instead — deliberately not part of this total.
      setStatsModalData(getPaymentsReceived(data || []).revenueRows);
      setStatsModalTitle(`Payments Received This Month (${today.toLocaleString('default', { month: 'long', year: 'numeric' })})`);
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
    setStatsDatePreset(DEFAULT_DATE_PRESET);
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
      if (statsDatePreset !== DEFAULT_DATE_PRESET && !isWithinRange(item.pay_datetime, statsDateRangeStart, statsDateRangeEnd)) return false;
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
    if (statsDatePreset !== DEFAULT_DATE_PRESET && !isWithinRange(item.event_datetime, statsDateRangeStart, statsDateRangeEnd)) return false;
    if (statsSearchTerm.trim()) {
      const term = statsSearchTerm.toLowerCase();
      const customerName = getClientName(item).toLowerCase();
      const ref = getBookingRef(item).toLowerCase();
      const venue = (item.venue || '').toLowerCase();
      if (!customerName.includes(term) && !ref.includes(term) && !venue.includes(term)) return false;
    }
    return true;
  });
  const activeStatsFilterCount = (statsSearchTerm.trim() ? 1 : 0) + (statsTypeFilter !== 'All' ? 1 : 0) + (statsModalType === 'revenue' && statsMethodFilter !== 'All' ? 1 : 0) + (statsDatePreset !== DEFAULT_DATE_PRESET ? 1 : 0);

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
        <h1 className="text-[27px] font-bold text-slate-900 tracking-tight">
          Good day, PG's Catering Manager
          <span className="text-[14.5px] font-normal text-slate-500 block mt-1.5">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </h1>
        <button
          onClick={fetchDashboardData}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-[10px] text-sm font-semibold text-slate-700 hover:border-[#008A45] hover:text-[#008A45] transition-colors"
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
          className="relative overflow-hidden bg-white border border-slate-200/70 rounded-2xl p-[22px] flex flex-col items-center justify-center text-center hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#008A45]" />
          <div className="w-[42px] h-[42px] rounded-full bg-[#EAF3F2] flex items-center justify-center mb-3">
            <CalendarIcon size={20} className="text-[#008A45]" />
          </div>
          <span className="text-[34px] font-semibold tracking-[-0.03em] tabular-nums text-slate-900 mb-2 leading-none">{stats.todayEvents}</span>
          <span className="text-[15px] font-semibold text-slate-600">Today's Events</span>
        </button>

        {/* Pending Orders (combined) */}
        <button
          onClick={handlePendingBookingsClick}
          className="relative overflow-hidden bg-white border border-slate-200/70 rounded-2xl p-[22px] flex flex-col items-center justify-center text-center hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-600" />
          <div className="w-[42px] h-[42px] rounded-full bg-amber-50 flex items-center justify-center mb-3">
            <Clock size={20} className="text-amber-600" />
          </div>
          <span className="text-[34px] font-semibold tracking-[-0.03em] tabular-nums text-slate-900 mb-2 leading-none">{stats.pendingBookings}</span>
          <span className="text-[15px] font-semibold text-slate-600">Pending Bookings &amp; Orders</span>
          <span className="text-[12.5px] text-slate-400 mt-1">(Packages + Short Orders)</span>
        </button>

        {/* Upcoming Events */}
        <button
          onClick={handleUpcomingEventsClick}
          className="relative overflow-hidden bg-white border border-slate-200/70 rounded-2xl p-[22px] flex flex-col items-center justify-center text-center hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-teal-600" />
          <div className="w-[42px] h-[42px] rounded-full bg-teal-50 flex items-center justify-center mb-3">
            <CheckCircle size={20} className="text-teal-600" />
          </div>
          <span className="text-[34px] font-semibold tracking-[-0.03em] tabular-nums text-slate-900 mb-2 leading-none">{stats.upcomingEvents}</span>
          <span className="text-[15px] font-semibold text-slate-600">Events in the next 7 days</span>
          {/* The window includes today: the query is
              .gte(today 00:00) .lt(today+7d 00:00), i.e. today plus the
              following six days. Stating the range beats making the manager
              infer whether "7 days" counts today. */}
          <span className="text-[12.5px] text-slate-400 mt-1">{upcomingWindowLabel()}</span>
        </button>

        {/* Payments Received This Month */}
        <button
          onClick={handleRevenueClick}
          className="relative overflow-hidden bg-white border border-slate-200/70 rounded-2xl p-[22px] flex flex-col items-center justify-center text-center hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30 transition-all cursor-pointer group"
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#006634]" />
          <div className="w-[42px] h-[42px] rounded-full bg-[#EAF3F2] flex items-center justify-center mb-3">
            <TrendingUp size={20} className="text-[#006634]" />
          </div>
          <span className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums text-slate-900 mb-2 leading-none">
            ₱{stats.revenueThisMonth.toLocaleString()}
          </span>
          <span className="text-[15px] font-semibold text-slate-600">Payments Received This Month</span>
          {/* Panel, 29 May 2026 (Förster): "Only confirmed & completed bookings
              should count as part of revenue — collectables/payables must not
              yet be included."

              Applied literally, as asked. The headline counts verified
              payments on Confirmed and Completed bookings only, anchored on
              pay_datetime — so nothing owed can reach it (an unpaid balance
              has no payment row) and nothing on a booking still awaiting
              confirmation can either.

              The money that filter excludes is shown beneath rather than
              dropped, because a figure a manager cannot find is worse than one
              they disagree with. What used to make this filter unsafe — cash
              stranded on an Approved booking nobody had confirmed — is handled
              at source: verifying a payment now offers the Confirm Event
              dialog immediately (utils/confirmBooking.js). */}
          <span className="text-[12.5px] text-slate-400 mt-1">Verified payments on confirmed &amp; completed bookings</span>
          {/* Cash taken on a booking that was later cancelled is real money but
              not live business, so getPaymentsReceived splits it out and the
              headline above excludes it. It was being computed and then thrown
              away — and it is precisely the deduction the panel asked to be
              able to see. Shown only when there is some, so a clean month stays
              clean. */}
          {stats.awaitingConfirmationThisMonth > 0 && (
            <span className="text-[12.5px] text-slate-500 mt-1">
              plus ₱{stats.awaitingConfirmationThisMonth.toLocaleString()} awaiting confirmation
            </span>
          )}
          {stats.retainedThisMonth > 0 && (
            <span className="text-[12.5px] text-amber-700 mt-1">
              plus ₱{stats.retainedThisMonth.toLocaleString()} retained from cancellations
            </span>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: Calendar & Today's Events */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="mb-[22px] bg-[#fbfcfd] border border-slate-100 rounded-2xl p-4 pt-[18px]">
            <div className="flex justify-between items-center mb-4 px-2">
              <button onClick={() => changeMonth(-1)} className="p-1.5 hover:bg-[#EAF3F2] hover:text-[#008A45] rounded-lg transition-colors">
                <ChevronLeft size={20} className="text-slate-600" />
              </button>
              <h3 className="font-bold text-slate-900 text-base">{monthName}</h3>
              <button onClick={() => changeMonth(1)} className="p-1.5 hover:bg-[#EAF3F2] hover:text-[#008A45] rounded-lg transition-colors">
                <ChevronRight size={20} className="text-slate-600" />
              </button>
            </div>
            {/* Only Confirmed bookings/orders show on this calendar — not
                Pending, Approved, or Completed — so the dots reflect what's
                actually locked in for the month, not everything submitted. */}
            <p className="text-center text-[12.5px] text-slate-500 mb-3.5">Showing confirmed bookings &amp; orders only</p>
            <div className="grid grid-cols-7 gap-1 max-w-[430px] mx-auto mb-2 py-[7px] bg-[#EAF3F2] rounded-[9px]">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                <div key={i} className="text-center text-xs font-bold tracking-[0.06em] text-[#0b6b3c]">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1.5 gap-x-1 max-w-[430px] mx-auto">
              {calendarDays.map((day, index) => {
                // Tint the cell by what kind of event sits on it, so the month
                // reads at a glance without decoding dots one day at a time.
                const packageOnly = day?.hasPackage && !day?.hasShortOrder;
                const shortOnly   = day?.hasShortOrder && !day?.hasPackage;
                const bothTypes   = day?.hasPackage && day?.hasShortOrder;

                const dayClass = day?.isToday
                  ? 'bg-[#008A45] text-white font-bold ring-[3px] ring-[#008A45]/15'
                  : packageOnly
                    ? 'bg-[#e3f2ea] ring-1 ring-inset ring-[#bfe0cd] text-[#00703a] font-bold'
                    : shortOnly
                      ? 'bg-[#f6edfe] ring-1 ring-inset ring-[#e2cdf7] text-[#7e22ce] font-bold'
                      : bothTypes
                        ? 'bg-gradient-to-br from-[#e3f2ea] from-50% to-[#f6edfe] to-50% ring-1 ring-inset ring-slate-300 text-slate-700 font-bold'
                        : 'text-slate-700 font-medium hover:bg-[#EAF3F2] hover:text-[#008A45]';

                return (
                  <div
                    key={index}
                    onClick={() => handleDayClick(day)}
                    className={`relative flex items-center justify-center cursor-pointer rounded-full w-[30px] h-[30px] text-[14.5px] tabular-nums mx-auto transition-colors ${dayClass}`}
                  >
                    {day?.day}
                    {day?.hasEvent && (
                      <span className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 flex items-center gap-0.5">
                        {day.hasPackage && (
                          <span className={`w-1.5 h-1.5 rounded-full ${day.isToday ? 'bg-white' : 'bg-[#007038]'}`}></span>
                        )}
                        {day.hasShortOrder && (
                          <span className={`w-1.5 h-1.5 rounded-full ${day.isToday ? 'bg-white/70' : 'bg-[#7e22ce]'}`}></span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-2 mt-3.5">
              <span className="flex items-center gap-[7px] px-[11px] py-1 bg-[#EAF3F2] rounded-full text-[12.5px] font-semibold text-[#00703a]">
                <span className="w-[7px] h-[7px] rounded-full bg-[#007038]" /> Package
              </span>
              <span className="flex items-center gap-[7px] px-[11px] py-1 bg-[#f6edfe] rounded-full text-[12.5px] font-semibold text-[#7e22ce]">
                <span className="w-[7px] h-[7px] rounded-full bg-[#7e22ce]" /> Short Order
              </span>
            </div>
          </div>

          <h3 className="text-[17px] font-bold tracking-[-0.01em] text-slate-900 mb-3.5">Today's Events</h3>
          <div className="space-y-2">
            {todayEvents.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-4">No events scheduled for today.</p>
            ) : (
              todayEvents.map((event) => (
                <div
                  key={event.booking_id}
                  onClick={() => navigate(`/app/bookings/${event.booking_id}`)}
                  className="bg-[#fbfcfd] border border-slate-100 rounded-xl px-3.5 py-3.5 flex justify-between items-center hover:border-[#c9dfd4] hover:bg-[#EAF3F2] transition-colors cursor-pointer"
                >
                  <div>
                    <p className="font-semibold text-slate-900 text-[15.5px]">{getClientName(event)}</p>
                    <p className="text-[13.5px] text-slate-500 mt-[3px]">{getVenueDisplay(event)} · {event.pax_count || 0} pax</p>
                  </div>
                  <span className="text-[15.5px] font-semibold text-[#008A45] tabular-nums">{formatTime(event.event_datetime)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: Pending Orders (combined) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm h-fit">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-[19px] font-bold tracking-[-0.015em] text-slate-900">Pending Bookings &amp; Orders</h2>
            <button
              onClick={() => navigate('/app/bookings')}
              className="text-[14.5px] font-semibold text-[#008A45] hover:text-[#007038] transition-colors"
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
                  <div key={item.booking_id} className="bg-[#fbfcfd] border border-slate-100 rounded-2xl p-4 hover:border-slate-200 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4
                            onClick={() => navigate(`${detailPath}/${item.booking_id}`)}
                            className="font-semibold text-slate-900 text-[15.5px] cursor-pointer hover:text-[#008A45] transition-colors"
                          >
                            {getClientName(item)}
                          </h4>
                          <span className={`text-[12.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${isShortOrder ? 'bg-[#f6edfe] text-[#7e22ce]' : 'bg-[#EAF3F2] text-[#00703a]'}`}>
                            {isShortOrder ? 'Short Order' : 'Package'}
                          </span>
                        </div>
                        <p className="text-[13.5px] text-slate-500 mt-[5px] tabular-nums">
                          {formatDate(item.event_datetime)} · {item.venue || 'No venue'}
                          {!isShortOrder && ` · ${item.pax_count || 0} pax`}
                        </p>
                      </div>
                      <span className="bg-amber-50 border border-amber-200 text-amber-700 text-[13px] px-3 py-1 rounded-full font-semibold">
                        Pending
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openApprovalModal(item, isShortOrder ? 'shortorder' : 'package')}
                        className="flex-1 bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm py-2 rounded-[10px] flex justify-center items-center gap-2 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Approve
                      </button>
                      <button
                        onClick={() => openRejectionModal(item.booking_id)}
                        className="flex-1 bg-white border border-red-200 text-red-700 font-semibold text-sm py-2 rounded-[10px] hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Reject
                      </button>
                      <button
                        onClick={() => navigate(`${detailPath}/${item.booking_id}`)}
                        className="flex-1 bg-white border border-slate-200 text-slate-700 font-semibold text-sm py-2 rounded-[10px] hover:bg-slate-50 transition-colors"
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
                      placeholder="Search by customer name, reference, or venue"
                      value={statsSearchTerm}
                      onChange={(e) => setStatsSearchTerm(e.target.value)}
                      className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${statsSearchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                    />
                  </div>
                  <Select
                    value={statsTypeFilter}
                    onChange={(e) => setStatsTypeFilter(e.target.value)}
                    className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${statsTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                  >
                    <option value="All">All types</option>
                    <option value="Package">Package</option>
                    <option value="Short Order">Short Order</option>
                  </Select>
                  {statsModalType === 'revenue' && (
                    <Select
                      value={statsMethodFilter}
                      onChange={(e) => setStatsMethodFilter(e.target.value)}
                      className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${statsMethodFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                    >
                      <option value="All">All methods</option>
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </Select>
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
                {/* Only the Pending modal gets a date filter, because it is
                    the only one whose rows are not already scoped by date. The
                    other three are queried inside a window — this month's
                    payments, today's events, the next seven days — so a filter
                    over them can narrow the set but never widen it, while
                    DateRangeFilter announced the range it believed it had
                    applied. Choosing "This Year" on the payments modal printed
                    "Jan 1 – Dec 31, 2026" over September's rows alone: ₱11,400
                    against a real ₱26,650. The default was the same lie in
                    reverse — "Showing all-time data" over one month.

                    Those three state their period in their own title, which is
                    where a scope the reader cannot change belongs. */}
                {statsModalType === 'pending' && (
                <div className="flex flex-col items-start gap-1">
                  <p className="text-xs font-semibold text-slate-600">
                    Filter by event date:
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
                    onClear={() => { setStatsDatePreset(DEFAULT_DATE_PRESET); setStatsDateCustomStart(''); setStatsDateCustomEnd(''); }}
                  />
                </div>
                )}
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
                          <th className="p-3">Reference</th>
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

                  {/* Total Collections - payment list */}
                  {statsModalType === 'revenue' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Reference</th>
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
                          <td colSpan="3" className="p-3 text-right font-bold text-slate-700">Total received:</td>
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
                  <p className="text-xs text-slate-500 mt-2">
                  {/* The extra-pax input is hidden on a fixed package — it covers
                      a band and refuses anything outside it — so this line must
                      not keep offering it. Per-pax packages still have it. */}
                  {approvalBooking.package?.pricing_type === 'fixed'
                    ? '* Add fees below.'
                    : '* Adjust extra pax or add fees below.'}
                </p>
                )}
                {approvalBooking.booking_type === 'Short Order' && (
                  <p className="text-xs text-slate-500 mt-2">* Short order pricing is per tray. You can add extra fees below.</p>
                )}
              </div>

              <div className="space-y-4">
                {approvalBooking.booking_type === 'Package' ? (
                  <>
                    {/* Hidden on a fixed package. It covers a band now, and a
                        booking outside that band is refused — so extra guests
                        cannot change the total, and a field that cannot change
                        anything should not be asking for a number. Per-pax
                        packages have no cap and keep it. */}
                    {approvalBooking.package?.pricing_type !== 'fixed' && (
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
                      <p className="text-xs text-slate-400 mt-1">
                    Each extra guest costs ₱{extraPaxRate(approvalBooking.package).toLocaleString()}
                    {approvalBooking.package?.pricing_type === 'per_pax'
                      ? ' (this package is priced per guest).'
                      : ' (the extra-guest rate for this fixed-price package).'}
                  </p>
                    </div>
                    )}
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
                <p>Downpayment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">Downpayment is required to secure the order. Non-refundable within 3 days of the event.</p>
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
                  placeholder="e.g., Incomplete details, customer requested cancellation, etc."
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