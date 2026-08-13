// src/pages/Reports.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export default function Reports() {
  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('Financial');
  const [isLoading, setIsLoading] = useState(true);

  // --- DATA STATE ---
  const [financialSummary, setFinancialSummary] = useState({
    totalRevenue: 0,
    collected: 0,
    outstanding: 0,
    currentMonthLabel: '',
  });

  // --- CLICKABLE CARD MODAL STATE ---
  const [detailModal, setDetailModal] = useState({
    open: false,
    type: null, // 'revenue' | 'collected' | 'outstanding'
    data: [],
    title: '',
  });

  const [monthlyRevenueData, setMonthlyRevenueData] = useState([]);
  const [menuPerformanceData, setMenuPerformanceData] = useState([]);
  const [equipmentUtilizationData, setEquipmentUtilizationData] = useState([]);
  const [bookingSummaryData, setBookingSummaryData] = useState([]);

  // --- Colors for charts ---
  const COLORS = ['#008A45', '#2d9b5e', '#5cb885', '#8cd4a8', '#b5e8ca', '#d4f0e0'];

  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // Helper to format booking reference
  const getBookingRef = (booking) => {
    if (booking.booking_number) return booking.booking_number;
    const prefix = booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
    return `${prefix}-${booking.booking_id.slice(0, 8)}`;
  };

  // --- FETCH ALL REPORT DATA ---
  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const now = new Date();
      const currentMonthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

      // ========== FINANCIAL SUMMARY ==========
      // Only include bookings that are not Rejected/Cancelled
      const { data: bookings, error: bookingsError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_number,
          booking_type,
          event_datetime,
          total_amount,
          booking_status,
          customer:customer_id (first_name, last_name)
        `)
        .not('booking_status', 'in', '("Rejected","Cancelled")');

      if (bookingsError) throw bookingsError;

      const validBookingIds = new Set(bookings.map(b => b.booking_id));

      const { data: payments, error: paymentsError } = await supabase
        .from('payment')
        .select('payment_id, amount_paid, pay_datetime, pay_status, booking_id');
      if (paymentsError) throw paymentsError;

      const paymentMap = {};
      payments.forEach(p => {
        if (!validBookingIds.has(p.booking_id)) return;
        if (!paymentMap[p.booking_id]) paymentMap[p.booking_id] = 0;
        paymentMap[p.booking_id] += p.amount_paid;
      });

      let totalCollected = 0;
      let totalOutstanding = 0;
      let totalContractValue = 0;

      const revenueBreakdown = [];
      const collectedBreakdown = [];
      const outstandingBreakdown = [];

      bookings.forEach(b => {
        const paid = paymentMap[b.booking_id] || 0;
        const total = b.total_amount || 0;
        const outstanding = Math.max(0, total - paid);

        totalContractValue += total;
        totalCollected += paid;
        totalOutstanding += outstanding;

        const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
        const bookingRef = getBookingRef(b);
        const bookingInfo = {
          id: b.booking_id,
          bookingRef,
          customer: customerName,
          eventDate: b.event_datetime,
          total,
          paid,
          outstanding,
          status: b.booking_status,
          type: b.booking_type || 'Package',
        };

        revenueBreakdown.push(bookingInfo);
        if (paid > 0) {
          const paymentDetails = payments.filter(p => p.booking_id === b.booking_id && validBookingIds.has(p.booking_id));
          collectedBreakdown.push({ ...bookingInfo, paymentDetails });
        }
        if (outstanding > 0) outstandingBreakdown.push(bookingInfo);
      });

      setFinancialSummary({
        totalRevenue: totalContractValue,
        collected: totalCollected,
        outstanding: totalOutstanding,
        currentMonthLabel,
        _revenueBreakdown: revenueBreakdown,
        _collectedBreakdown: collectedBreakdown,
        _outstandingBreakdown: outstandingBreakdown,
      });

      // ========== MONTHLY REVENUE (Net Collected) ==========
      const monthMap = {};
      payments.forEach(p => {
        if (!validBookingIds.has(p.booking_id)) return;
        if (!p.pay_datetime) return;
        const date = new Date(p.pay_datetime);
        const monthKey = date.toLocaleString('default', { month: 'short' });
        if (!monthMap[monthKey]) monthMap[monthKey] = 0;
        monthMap[monthKey] += p.amount_paid;
      });

      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyData = monthOrder
        .filter(m => monthMap[m] && monthMap[m] > 0)
        .map((month, index) => ({
          month,
          revenue: monthMap[month],
        }));
      setMonthlyRevenueData(monthlyData);

      // ========== MENU PERFORMANCE ==========
      // Packages
      const { data: packageBookings, error: pkgError } = await supabase
        .from('booking')
        .select(`
          package_id,
          total_amount,
          booking_status,
          package:package_id (pkg_name, pricing_type)
        `)
        .eq('booking_type', 'Package')
        .not('package_id', 'is', null)
        .not('booking_status', 'in', '("Rejected","Cancelled")');

      if (pkgError) throw pkgError;

      const packageMap = {};
      packageBookings.forEach(b => {
        const pkgId = b.package_id;
        if (!packageMap[pkgId]) {
          packageMap[pkgId] = {
            name: b.package?.pkg_name || 'Unknown',
            type: 'Package',
            orders: 0,
            revenue: 0,
          };
        }
        packageMap[pkgId].orders += 1;
        packageMap[pkgId].revenue += b.total_amount || 0;
      });

      // Short Order Menu Items
      const { data: shortOrderBookings, error: soError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          total_amount,
          menu_selections,
          booking_status
        `)
        .eq('booking_type', 'Short Order')
        .not('booking_status', 'in', '("Rejected","Cancelled")');

      if (soError) throw soError;

      const menuItemMap = {};

      for (const so of shortOrderBookings) {
        let selections = [];
        try {
          if (so.menu_selections) {
            if (typeof so.menu_selections === 'string') {
              selections = JSON.parse(so.menu_selections);
            } else if (Array.isArray(so.menu_selections)) {
              selections = so.menu_selections;
            }
          }
        } catch (e) {
          selections = [];
        }

        const menuItemIds = selections.map(s => s.menu_item_id);
        let menuItemsMap = {};
        if (menuItemIds.length > 0) {
          const { data: menuData, error: menuError } = await supabase
            .from('menu_item')
            .select('menu_item_id, menu_name, menu_price')
            .in('menu_item_id', menuItemIds);
          if (!menuError && menuData) {
            menuItemsMap = Object.fromEntries(menuData.map(m => [m.menu_item_id, m]));
          }
        }

        selections.forEach(sel => {
          const itemId = sel.menu_item_id;
          const qty = sel.quantity || 1;
          const menuItem = menuItemsMap[itemId];
          const price = menuItem?.menu_price || 0;
          const name = menuItem?.menu_name || 'Unknown Item';

          if (!menuItemMap[itemId]) {
            menuItemMap[itemId] = {
              name,
              type: 'Menu Item',
              orders: 0,
              quantity: 0,
              revenue: 0,
            };
          }
          menuItemMap[itemId].orders += 1;
          menuItemMap[itemId].quantity += qty;
          menuItemMap[itemId].revenue += price * qty;
        });
      }

      // Combine
      const combinedMenuPerf = [];

      Object.values(packageMap).forEach(pkg => {
        combinedMenuPerf.push({
          ...pkg,
          quantity: pkg.orders,
        });
      });

      Object.values(menuItemMap).forEach(item => {
        combinedMenuPerf.push({
          name: item.name,
          type: 'Menu Item',
          orders: item.orders,
          quantity: item.quantity,
          revenue: item.revenue,
        });
      });

      combinedMenuPerf.sort((a, b) => b.revenue - a.revenue);

      const maxRevenue = combinedMenuPerf.length > 0 ? Math.max(...combinedMenuPerf.map(d => d.revenue)) : 1;
      const menuPerf = combinedMenuPerf.map((item, index) => ({
        id: `PERF-${index + 1}`,
        name: item.name,
        type: item.type,
        performance: Math.round((item.revenue / maxRevenue) * 100),
        totalOrders: item.orders,
        quantity: item.quantity || item.orders,
        revenueGenerated: item.revenue,
        status: item.revenue < maxRevenue * 0.1 ? 'warning' : 'good',
      }));
      setMenuPerformanceData(menuPerf);

      // ========== EQUIPMENT UTILIZATION ==========
      const { data: equipment, error: equipError } = await supabase
        .from('equipment')
        .select('equipment_id, eqm_name, quantity_available, eqm_status')
        .order('eqm_name');
      if (equipError) throw equipError;

      const { data: deployedData, error: deployedError } = await supabase
        .from('booking_equipment')
        .select('equipment_id, quantity, returned')
        .eq('returned', false);
      if (deployedError) throw deployedError;

      const deployedMap = {};
      deployedData.forEach(d => {
        if (!deployedMap[d.equipment_id]) deployedMap[d.equipment_id] = 0;
        deployedMap[d.equipment_id] += d.quantity;
      });

      const utilData = equipment.map(eq => {
        const deployed = deployedMap[eq.equipment_id] || 0;
        const available = eq.quantity_available;
        const total = available + deployed;
        return {
          id: eq.equipment_id,
          name: eq.eqm_name,
          total,
          available,
          deployed,
          damaged: 0,
        };
      });
      setEquipmentUtilizationData(utilData);

      // ========== BOOKING SUMMARY – ONLY COMPLETED ==========
      const { data: completedBookings, error: allError } = await supabase
        .from('booking')
        .select('booking_id, event_datetime, total_amount, booking_status, booking_type, package_id, package:package_id (pkg_name)')
        .eq('booking_status', 'Completed')
        .not('event_datetime', 'is', null);

      if (allError) throw allError;

      const monthGroup = {};
      completedBookings.forEach(b => {
        const date = new Date(b.event_datetime);
        const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (!monthGroup[monthKey]) {
          monthGroup[monthKey] = {
            bookings: 0,
            revenue: 0,
            topPackage: '',
            packageCounts: {},
          };
        }
        const group = monthGroup[monthKey];
        group.bookings += 1;
        group.revenue += b.total_amount || 0;

        if (b.booking_type === 'Package' && b.package_id) {
          const pkgName = b.package?.pkg_name || 'Unknown';
          if (!group.packageCounts[pkgName]) group.packageCounts[pkgName] = 0;
          group.packageCounts[pkgName] += 1;
        }
      });

      const summary = Object.entries(monthGroup).map(([month, data], index) => {
        let topPackage = 'None';
        let maxCount = 0;
        Object.entries(data.packageCounts).forEach(([pkg, count]) => {
          if (count > maxCount) {
            maxCount = count;
            topPackage = pkg;
          }
        });
        return {
          id: `RPT-${index + 1}`,
          month,
          bookings: data.bookings,
          revenue: data.revenue,
          topPackage,
        };
      });
      setBookingSummaryData(summary);

    } catch (error) {
      handleError(error, 'Failed to load report data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, []);

  // --- Formatting ---
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount).replace('PHP', '₱');
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // --- Card Click Handler ---
  const handleCardClick = (type) => {
    let data = [];
    let title = '';
    switch (type) {
      case 'revenue':
        data = financialSummary._revenueBreakdown || [];
        title = 'Total Revenue Breakdown';
        break;
      case 'collected':
        data = financialSummary._collectedBreakdown || [];
        title = 'Collected Payments Breakdown';
        break;
      case 'outstanding':
        data = financialSummary._outstandingBreakdown || [];
        title = 'Outstanding Balances Breakdown';
        break;
      default:
        return;
    }
    setDetailModal({ open: true, type, data, title });
  };

  const closeDetailModal = () => {
    setDetailModal({ open: false, type: null, data: [] });
  };

  // --- Render ---
  return (
    <div className="space-y-6 relative pb-12 pr-2">
      {/* PAGE TITLE HEADER */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">
          Financial performance and operational summaries – includes both Packages and Short Orders.
          <span className="block text-xs text-slate-400 mt-1">Excludes Rejected and Cancelled bookings.</span>
          <span className="block text-xs text-slate-400 mt-1">Booking Summary shows only <strong>Completed</strong> events.</span>
        </p>
      </div>

      {/* TABS */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {['Financial', 'Menu Performance', 'Equipment Utilization', 'Booking Summary'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                whitespace-nowrap py-3 px-1 border-b-2 font-semibold text-sm transition-all duration-200
                ${activeTab === tab
                  ? 'border-emerald-600 text-emerald-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
              `}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* LOADING / CONTENT */}
      {isLoading ? (
        <div className="w-full py-20 flex justify-center items-center text-slate-400 font-medium animate-pulse">
          Loading metrics and database summaries...
        </div>
      ) : (
        <div className="animate-in fade-in duration-200 space-y-6">

          {/* ========================================================= */}
          {/* FINANCIAL TAB */}
          {/* ========================================================= */}
          {activeTab === 'Financial' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => handleCardClick('revenue')}
                  className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6 text-left transition-all hover:shadow-md hover:border-emerald-300 hover:bg-[#dcefed] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
                >
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Total Revenue</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.totalRevenue)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">{financialSummary.currentMonthLabel}</p>
                  <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
                </button>
                <button
                  onClick={() => handleCardClick('collected')}
                  className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6 text-left transition-all hover:shadow-md hover:border-emerald-300 hover:bg-[#dcefed] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
                >
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Collected</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.collected)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">All payments received</p>
                  <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
                </button>
                <button
                  onClick={() => handleCardClick('outstanding')}
                  className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6 text-left transition-all hover:shadow-md hover:border-emerald-300 hover:bg-[#dcefed] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
                >
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Outstanding</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.outstanding)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">Remaining balances</p>
                  <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
                </button>
              </div>

              {/* MONTHLY REVENUE – Net Collected Bar Chart */}
              <div className="bg-[#f8fafa] border border-slate-200 rounded-xl p-6">
                <h3 className="text-base font-bold text-slate-900 mb-4">Monthly Revenue (Net Collected)</h3>
                {monthlyRevenueData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
                    No payment data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlyRevenueData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(value) => `₱${value.toLocaleString()}`} />
                      <Tooltip
                        formatter={(value) => [`₱${value.toLocaleString()}`, 'Collected']}
                        labelFormatter={(label) => `Month: ${label}`}
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="#008A45" radius={[4, 4, 0, 0]}>
                        {monthlyRevenueData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <div className="mt-2 text-xs text-slate-500 text-right">
                  Bar shows total payments received per month (net collected)
                </div>
              </div>

              {/* BOOKING SUMMARY MINI – quick view (still shows all, but the full tab shows only Completed) */}
              <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200"><h3 className="text-base font-bold text-slate-900">Monthly Booking Summary (All Active)</h3></div>
                {bookingSummaryData.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">No completed bookings yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                          <th className="p-4">Month</th>
                          <th className="p-4">Completed Bookings</th>
                          <th className="p-4">Revenue</th>
                          <th className="p-4">Top Package</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                        {bookingSummaryData.slice(0, 3).map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50">
                            <td className="p-4 font-bold text-slate-900">{row.month}</td>
                            <td className="p-4">{row.bookings}</td>
                            <td className="p-4 font-semibold text-slate-900">{formatCurrency(row.revenue)}</td>
                            <td className="p-4">{row.topPackage}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* MENU PERFORMANCE TAB */}
          {/* ========================================================= */}
          {activeTab === 'Menu Performance' && (
            <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">Comprehensive Menu Performance – Packages & Short Order Items</h3>
                <p className="text-xs text-slate-500 mt-1">Performance is based on total revenue generated (relative to highest performer).</p>
              </div>
              {menuPerformanceData.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">No performance data available.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                        <th className="p-4">Name</th>
                        <th className="p-4">Type</th>
                        <th className="p-4">Popularity Metric</th>
                        <th className="p-4">Total Orders / Qty</th>
                        <th className="p-4">Gross Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {menuPerformanceData.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 font-bold text-slate-900">{item.name}</td>
                          <td className="p-4">
                            {item.type === 'Package' ? (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full border border-blue-200 whitespace-nowrap">
                                Package
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full border border-purple-200 whitespace-nowrap">
                                Menu Item
                              </span>
                            )}
                          </td>
                          <td className="p-4 w-1/3">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold text-slate-600 w-8">{item.performance}%</span>
                              <div className="w-full bg-slate-200 rounded-full h-2 max-w-xs">
                                <div className={`h-2 rounded-full ${item.status === 'warning' ? 'bg-red-500' : 'bg-[#008A45]'}`} style={{ width: `${item.performance}%` }}></div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 font-medium text-slate-700">
                            {item.type === 'Menu Item' ? `${item.quantity} trays` : `${item.totalOrders} orders`}
                          </td>
                          <td className="p-4 font-bold text-emerald-700">{formatCurrency(item.revenueGenerated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* EQUIPMENT UTILIZATION TAB */}
          {/* ========================================================= */}
          {activeTab === 'Equipment Utilization' && (
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">Equipment Operational Fleet Capacity</h3>
                </div>
                {equipmentUtilizationData.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">No equipment data available.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                          <th className="p-4">Equipment Classification</th>
                          <th className="p-4">Total Inventory</th>
                          <th className="p-4">Deployed Today</th>
                          <th className="p-4">Available In House</th>
                          <th className="p-4">Damaged / Flagged</th>
                          <th className="p-4">Utilization Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {equipmentUtilizationData.map((item) => {
                          const usageRate = item.total > 0 ? Math.round((item.deployed / item.total) * 100) : 0;
                          return (
                            <tr key={item.id} className="hover:bg-slate-50">
                              <td className="p-4 font-bold text-slate-900">{item.name}</td>
                              <td className="p-4 text-slate-700 font-semibold">{item.total} Units</td>
                              <td className="p-4 text-blue-600 font-medium">{item.deployed} Deployed</td>
                              <td className="p-4 text-emerald-600 font-medium">{item.available} Ready</td>
                              <td className="p-4 text-red-500 font-medium">{item.damaged} Unusable</td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-slate-200 rounded-full h-1.5">
                                    <div className="h-1.5 rounded-full bg-slate-700" style={{ width: `${usageRate}%` }}></div>
                                  </div>
                                  <span className="text-xs font-bold text-slate-700">{usageRate}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* BOOKING SUMMARY TAB – Only Completed */}
          {/* ========================================================= */}
          {activeTab === 'Booking Summary' && (
            <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">Historical Booking Summary – Completed Events Only</h3>
                <p className="text-xs text-slate-500 mt-1">Includes only bookings that have been marked as Completed.</p>
              </div>
              {bookingSummaryData.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">No completed bookings found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                        <th className="p-4">Accounting Month</th>
                        <th className="p-4">Total Completed Bookings</th>
                        <th className="p-4">Gross Revenue</th>
                        <th className="p-4">Top Package</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {bookingSummaryData.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 font-bold text-slate-900">{row.month}</td>
                          <td className="p-4 text-slate-700 font-medium">{row.bookings} Completed</td>
                          <td className="p-4 font-bold text-slate-900">{formatCurrency(row.revenue)}</td>
                          <td className="p-4"><span className="px-2.5 py-1 bg-slate-200 text-slate-800 font-semibold text-xs rounded-full">{row.topPackage}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* DETAIL BREAKDOWN MODAL – unchanged */}
      {detailModal.open && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{detailModal.title}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Excludes Rejected and Cancelled bookings • {detailModal.data.length} records found
                </p>
              </div>
              <button
                onClick={closeDetailModal}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {detailModal.data.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No records found for this category.</div>
              ) : (
                <div className="space-y-4">
                  {detailModal.type === 'revenue' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Booking Ref</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Event Date</th>
                          <th className="p-3 text-right">Contract Value</th>
                          <th className="p-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {detailModal.data.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono text-xs font-semibold text-slate-800">{item.bookingRef}</td>
                            <td className="p-3 font-medium text-slate-900">{item.customer}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600">{formatDate(item.eventDate)}</td>
                            <td className="p-3 text-right font-bold text-slate-900">{formatCurrency(item.total)}</td>
                            <td className="p-3 text-right">
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-700' : item.status === 'Approved' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="4" className="p-3 text-right font-bold text-slate-700">Total:</td>
                          <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(detailModal.data.reduce((sum, item) => sum + item.total, 0))}</td>
                          <td className="p-3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {detailModal.type === 'collected' && (
                    <div className="space-y-6">
                      {detailModal.data.map((item) => (
                        <div key={item.id} className="border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h4 className="font-bold text-slate-900">
                                <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded mr-2">{item.bookingRef}</span>
                                {item.customer}
                              </h4>
                              <p className="text-xs text-slate-500">Event: {formatDate(item.eventDate)} · {item.type}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-emerald-600">{formatCurrency(item.paid)}</p>
                              <p className="text-xs text-slate-500">of {formatCurrency(item.total)}</p>
                            </div>
                          </div>
                          {item.paymentDetails && item.paymentDetails.length > 0 && (
                            <div className="bg-slate-50 rounded p-3 mt-2">
                              <p className="text-xs font-semibold text-slate-600 mb-2">Payment History:</p>
                              <div className="space-y-1">
                                {item.paymentDetails.map((pay, idx) => (
                                  <div key={idx} className="flex justify-between text-xs text-slate-600">
                                    <span>{formatDate(pay.pay_datetime)}</span>
                                    <span className="font-medium">{formatCurrency(pay.amount_paid)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="border-t pt-4 flex justify-end">
                        <p className="text-lg font-bold text-slate-900">
                          Total Collected: <span className="text-emerald-600">{formatCurrency(detailModal.data.reduce((sum, item) => sum + item.paid, 0))}</span>
                        </p>
                      </div>
                    </div>
                  )}

                  {detailModal.type === 'outstanding' && (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                          <th className="p-3">Booking Ref</th>
                          <th className="p-3">Customer</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Event Date</th>
                          <th className="p-3 text-right">Total</th>
                          <th className="p-3 text-right">Paid</th>
                          <th className="p-3 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {detailModal.data.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono text-xs font-semibold text-slate-800">{item.bookingRef}</td>
                            <td className="p-3 font-medium text-slate-900">{item.customer}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600">{formatDate(item.eventDate)}</td>
                            <td className="p-3 text-right text-slate-600">{formatCurrency(item.total)}</td>
                            <td className="p-3 text-right text-emerald-600">{formatCurrency(item.paid)}</td>
                            <td className="p-3 text-right font-bold text-red-600">{formatCurrency(item.outstanding)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan="6" className="p-3 text-right font-bold text-slate-700">Total Outstanding:</td>
                          <td className="p-3 text-right font-bold text-red-600">{formatCurrency(detailModal.data.reduce((sum, item) => sum + item.outstanding, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-4">
                    <p className="text-sm text-blue-800">
                      <strong>Note:</strong> This breakdown excludes all bookings with status "Rejected" or "Cancelled" to reflect only active and completed transactions.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={closeDetailModal}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}