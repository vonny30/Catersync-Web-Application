// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Clock, CheckCircle, TrendingUp, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

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
  const [pendingBookings, setPendingBookings] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarDays, setCalendarDays] = useState([]);
  const [eventDates, setEventDates] = useState({});

  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState([]);
  const [showDateModal, setShowDateModal] = useState(false);

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
      const todayStr = today.toISOString().split('T')[0];
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

      const { data: monthBookings, error: monthError } = await supabase
        .from('booking')
        .select('event_datetime, booking_status')
        .eq('booking_type', 'Package')
        .gte('event_datetime', startOfMonthStr)
        .lte('event_datetime', endOfMonthStr)
        .in('booking_status', ['Pending', 'Approved']);

      if (monthError) throw monthError;

      const eventMap = {};
      (monthBookings || []).forEach(b => {
        if (b.event_datetime) {
          const date = new Date(b.event_datetime).toISOString().split('T')[0];
          if (!eventMap[date]) eventMap[date] = 0;
          eventMap[date]++;
        }
      });
      setEventDates(eventMap);

      const { data: todayData, error: todayError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          venue,
          pax_count,
          event_datetime,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .eq('booking_status', 'Approved')
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${todayStr} 23:59:59`)
        .order('event_datetime', { ascending: true });

      if (todayError) throw todayError;
      setTodayEvents(todayData || []);
      setStats(prev => ({ ...prev, todayEvents: todayData?.length || 0 }));

      const { data: pendingData, error: pendingError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          venue,
          pax_count,
          event_datetime,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .eq('booking_status', 'Pending')
        .order('event_datetime', { ascending: true })
        .limit(5);

      if (pendingError) throw pendingError;
      setPendingBookings(pendingData || []);
      setStats(prev => ({ ...prev, pendingBookings: pendingData?.length || 0 }));

      const { data: upcomingData, error: upcomingError } = await supabase
        .from('booking')
        .select('booking_id')
        .eq('booking_type', 'Package')
        .eq('booking_status', 'Approved')
        .gte('event_datetime', `${todayStr} 00:00:00`)
        .lt('event_datetime', `${new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 00:00:00`);

      if (upcomingError) throw upcomingError;
      setStats(prev => ({ ...prev, upcomingEvents: upcomingData?.length || 0 }));

      const { data: revenueData, error: revenueError } = await supabase
        .from('payment')
        .select('amount_paid')
        .gte('pay_datetime', startOfMonthStr)
        .lte('pay_datetime', endOfMonthStr);

      if (revenueError) throw revenueError;
      const totalRevenue = (revenueData || []).reduce((sum, p) => sum + (p.amount_paid || 0), 0);
      setStats(prev => ({ ...prev, revenueThisMonth: totalRevenue }));

    } catch (error) {
      handleError(error, 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

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
      days.push({
        day: i,
        date: dateStr,
        hasEvent: !!eventDates[dateStr],
        isToday: dateStr === new Date().toISOString().split('T')[0],
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
          venue,
          pax_count,
          event_datetime,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', ['Pending', 'Approved', 'Completed'])
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

  const handleApprove = async (id) => {
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Approved' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Booking approved successfully!');
      fetchDashboardData();
    } catch (error) {
      handleError(error, 'Failed to approve booking.');
    }
  };

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
      fetchDashboardData();
    } catch (error) {
      handleError(error, 'Failed to reject booking.');
    }
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
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
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
        <div className="bg-[#EEF7F6] border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-10 h-10 border border-slate-300 rounded-full flex items-center justify-center mb-3">
            <CalendarIcon size={20} className="text-slate-700" />
          </div>
          <span className="text-3xl font-bold text-slate-900 mb-1">{stats.todayEvents}</span>
          <span className="text-sm font-medium text-slate-600">Today's Events</span>
        </div>

        <div className="bg-[#EEF7F6] border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-10 h-10 border border-slate-300 rounded-full flex items-center justify-center mb-3">
            <Clock size={20} className="text-slate-700" />
          </div>
          <span className="text-3xl font-bold text-slate-900 mb-1">{stats.pendingBookings}</span>
          <span className="text-sm font-medium text-slate-600">Pending Bookings</span>
        </div>

        <div className="bg-[#EEF7F6] border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-10 h-10 border border-slate-300 rounded-full flex items-center justify-center mb-3">
            <CheckCircle size={20} className="text-slate-700" />
          </div>
          <span className="text-3xl font-bold text-slate-900 mb-1">{stats.upcomingEvents}</span>
          <span className="text-sm font-medium text-slate-600">Upcoming Events (7 days)</span>
        </div>

        <div className="bg-[#EEF7F6] border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-10 h-10 border border-slate-300 rounded-full flex items-center justify-center mb-3">
            <TrendingUp size={20} className="text-slate-700" />
          </div>
          <span className="text-3xl font-bold text-slate-900 mb-1">
            ₱{stats.revenueThisMonth.toLocaleString()}
          </span>
          <span className="text-sm font-medium text-slate-600">Revenue This Month</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: Calendar & Today's Events */}
        <div className="bg-[#F8F9FA] border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="mb-6 border-b border-slate-200 pb-6">
            <div className="flex justify-between items-center mb-4 px-2">
              <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-200 rounded transition-colors">
                <ChevronLeft size={20} className="text-slate-600" />
              </button>
              <h3 className="font-bold text-slate-900 text-sm">{monthName}</h3>
              <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-200 rounded transition-colors">
                <ChevronRight size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-4 text-center text-sm">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
                <div key={idx} className="text-slate-400 font-medium text-xs">{day}</div>
              ))}
              {calendarDays.map((day, index) => (
                <div
                  key={index}
                  onClick={() => handleDayClick(day)}
                  className={`relative flex items-center justify-center font-medium text-sm cursor-pointer hover:bg-slate-200 rounded-full w-7 h-7 mx-auto transition-colors
                    ${day?.isToday ? 'bg-[#008A45] text-white' : ''}
                    ${day?.hasEvent && !day?.isToday ? 'text-slate-900' : 'text-slate-900'}
                  `}
                >
                  {day?.day}
                  {day?.hasEvent && !day?.isToday && (
                    <span className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-[#008A45] rounded-full"></span>
                  )}
                </div>
              ))}
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
                  className="bg-white border border-slate-200 rounded-lg p-4 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{getClientName(event)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{getVenueDisplay(event)} · {event.pax_count || 0} pax</p>
                  </div>
                  <span className="text-sm font-medium text-slate-700">{formatTime(event.event_datetime)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: Pending Bookings */}
        <div className="bg-[#F8F9FA] border border-slate-200 rounded-xl p-6 shadow-sm h-fit">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">Pending Bookings</h2>
            <button
              onClick={() => navigate('/app/bookings')}
              className="text-sm font-semibold text-slate-900 underline decoration-2 underline-offset-4 hover:text-[#008A45] transition-colors"
            >
              View All
            </button>
          </div>
          
          <div className="space-y-4">
            {pendingBookings.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-8">No pending bookings.</p>
            ) : (
              pendingBookings.map((booking) => (
                <div key={booking.booking_id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4
                        onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                        className="font-bold text-slate-900 text-sm cursor-pointer hover:text-[#008A45] transition-colors"
                      >
                        {getClientName(booking)}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatDate(booking.event_datetime)} · {booking.pax_count || 0} pax
                      </p>
                    </div>
                    <span className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1 rounded-full font-medium">
                      Pending
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleApprove(booking.booking_id)}
                      className="flex-1 bg-[#D1E8E6] text-slate-800 font-semibold text-sm py-2 rounded-lg flex justify-center items-center gap-2 hover:bg-[#b8dad7] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(booking.booking_id)}
                      className="flex-1 bg-red-50 border border-red-200 text-red-700 font-semibold text-sm py-2 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>
                    <button
                      onClick={() => navigate(`/app/bookings/${booking.booking_id}`)}
                      className="flex-1 bg-white border border-slate-300 text-slate-800 font-semibold text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))
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
                  {selectedDateEvents.map(event => (
                    <div
                      key={event.booking_id}
                      onClick={() => {
                        setShowDateModal(false);
                        navigate(`/app/bookings/${event.booking_id}`);
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{getClientName(event)}</p>
                        <p className="text-xs text-slate-500">{event.venue || 'No venue'} · {event.pax_count || 0} pax</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-600">{formatTime(event.event_datetime)}</span>
                        <span className={`block text-xs font-medium ${event.booking_status === 'Approved' ? 'text-green-600' : event.booking_status === 'Completed' ? 'text-blue-600' : 'text-amber-600'}`}>
                          {event.booking_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}