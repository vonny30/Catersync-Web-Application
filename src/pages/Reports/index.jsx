// src/pages/Reports/index.jsx
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabase';
import toast from 'react-hot-toast';
import { getBookingRef, getRangeBounds, isWithinRange } from './helpers';
import DateRangeFilter from './DateRangeFilter';
import DetailModal from './DetailModal';
import SimpleDetailModal from './SimpleDetailModal';
import OverviewTab from './OverviewTab';
import FinancialTab from './FinancialTab';
import MenuPerformanceTab from './MenuPerformanceTab';
import EquipmentUtilizationTab from './EquipmentUtilizationTab';
import VehicleUtilizationTab from './VehicleUtilizationTab';
import BookingSummaryTab from './BookingSummaryTab';

const TABS = [
  'Overview', 'Financial', 'Menu Performance',
  'Equipment Utilization', 'Vehicle Utilization', 'Booking Summary',
];

const CANCELLED_STATUSES = ['Rejected', 'Cancelled'];

export default function Reports() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [isLoading, setIsLoading] = useState(true);
  const [rawData, setRawData] = useState(null);

  const [datePreset, setDatePreset] = useState('All Time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [detailModal, setDetailModal] = useState({ open: false, type: null, data: [], title: '' });
  const [simpleModal, setSimpleModal] = useState({ open: false, title: '', description: '', badge: null, fields: [] });

  // Shared by every tab except Financial (which uses the full breakdown
  // modal above) — pass a title, a short description, an optional status
  // badge, and a handful of {label, value} fields. Kept deliberately small
  // so clicking a card/row answers the obvious question without dumping
  // another dense table on top of the one they just clicked from.
  const openSimpleModal = ({ title, description = '', badge = null, fields = [] }) => {
    setSimpleModal({ open: true, title, description, badge, fields });
  };
  const closeSimpleModal = () => setSimpleModal({ open: false, title: '', description: '', badge: null, fields: [] });

  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // ========== FETCH ALL RAW DATA (once) ==========
  const fetchRawData = async () => {
    setIsLoading(true);
    try {
      const [
        bookingsRes, paymentsRes, packagesRes, menuItemsRes, categoriesRes,
        packageCategoriesRes, equipmentRes, bookingEquipmentRes, vehiclesRes, vehicleAssignRes,
      ] = await Promise.all([
        supabase.from('booking').select(`
          booking_id, booking_number, booking_type, event_datetime, book_datetime,
          total_amount, booking_status, package_id, customer_id, menu_selections,
          package:package_id (pkg_name, pricing_type),
          customer:customer_id (first_name, last_name)
        `),
        supabase.from('payment').select('payment_id, amount_paid, pay_datetime, pay_status, pay_method, booking_id, customer_id'),
        supabase.from('package').select('*'),
        supabase.from('menu_item').select('*'),
        supabase.from('category').select('*'),
        supabase.from('package_category').select('package_id, category_id'),
        supabase.from('equipment').select('equipment_id, eqm_name, quantity_available, damaged_quantity, maintenance_quantity'),
        supabase.from('booking_equipment').select('equipment_id, quantity, returned').eq('returned', false),
        supabase.from('vehicle').select('vehicle_id, plate_number, vehicle_type, vehicle_status'),
        supabase.from('vehicle_assign').select('vehicle_id, booking_id, assignment_status'),
      ]);

      const allResults = [
        bookingsRes, paymentsRes, packagesRes, menuItemsRes, categoriesRes,
        packageCategoriesRes, equipmentRes, bookingEquipmentRes, vehiclesRes, vehicleAssignRes,
      ];
      for (const res of allResults) {
        if (res.error) throw res.error;
      }

      setRawData({
        bookings: bookingsRes.data || [],
        payments: paymentsRes.data || [],
        packages: packagesRes.data || [],
        menuItems: menuItemsRes.data || [],
        categories: categoriesRes.data || [],
        packageCategories: packageCategoriesRes.data || [],
        equipment: equipmentRes.data || [],
        bookingEquipment: bookingEquipmentRes.data || [],
        vehicles: vehiclesRes.data || [],
        vehicleAssignments: vehicleAssignRes.data || [],
      });
    } catch (error) {
      handleError(error, 'Failed to load report data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRawData();
  }, []);

  const { start: rangeStart, end: rangeEnd } = getRangeBounds(datePreset, customStart, customEnd);

  // ========== DERIVE EVERYTHING FROM RAW DATA + DATE RANGE ==========
  const derived = useMemo(() => {
    if (!rawData) return null;

    const { bookings, payments, menuItems, categories, packageCategories, equipment, bookingEquipment, vehicles, vehicleAssignments } = rawData;

    // Bookings whose EVENT falls in range (revenue/menu/summary anchor).
    const bookingsInEventRange = bookings.filter(b => !rangeStart && !rangeEnd ? true : isWithinRange(b.event_datetime, rangeStart, rangeEnd));
    // Bookings SUBMITTED in range (funnel/customer-acquisition anchor).
    const bookingsInSubmitRange = bookings.filter(b => !rangeStart && !rangeEnd ? true : isWithinRange(b.book_datetime, rangeStart, rangeEnd));
    // Payments RECEIVED in range.
    const paymentsInRange = payments.filter(p => !rangeStart && !rangeEnd ? true : isWithinRange(p.pay_datetime, rangeStart, rangeEnd));

    const activeBookingsInRange = bookingsInEventRange.filter(b => !CANCELLED_STATUSES.includes(b.booking_status));
    const activeBookingIds = new Set(activeBookingsInRange.map(b => b.booking_id));

    // --- FINANCIAL ---
    const paymentMap = {};
    payments.forEach(p => {
      if (!activeBookingIds.has(p.booking_id)) return;
      paymentMap[p.booking_id] = (paymentMap[p.booking_id] || 0) + p.amount_paid;
    });

    let totalCollected = 0, totalOutstanding = 0, totalContractValue = 0;
    const revenueBreakdown = [], collectedBreakdown = [], outstandingBreakdown = [];

    activeBookingsInRange.forEach(b => {
      const paid = paymentMap[b.booking_id] || 0;
      const total = b.total_amount || 0;
      const outstanding = Math.max(0, total - paid);
      totalContractValue += total;
      totalCollected += paid;
      totalOutstanding += outstanding;

      const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
      const bookingInfo = {
        id: b.booking_id, bookingRef: getBookingRef(b), customer: customerName,
        eventDate: b.event_datetime, total, paid, outstanding,
        status: b.booking_status, type: b.booking_type || 'Package',
      };
      revenueBreakdown.push(bookingInfo);
      if (paid > 0) {
        const paymentDetails = payments.filter(p => p.booking_id === b.booking_id && activeBookingIds.has(p.booking_id));
        collectedBreakdown.push({ ...bookingInfo, paymentDetails });
      }
      if (outstanding > 0) outstandingBreakdown.push(bookingInfo);
    });

    const financialSummary = {
      totalRevenue: totalContractValue,
      collected: totalCollected,
      outstanding: totalOutstanding,
      _revenueBreakdown: revenueBreakdown,
      _collectedBreakdown: collectedBreakdown,
      _outstandingBreakdown: outstandingBreakdown,
    };

    // Monthly revenue (net collected), from payments actually received in range.
    const monthMap = {};
    paymentsInRange.forEach(p => {
      if (!activeBookingIds.has(p.booking_id)) return;
      if (!p.pay_datetime || p.amount_paid <= 0) return;
      const date = new Date(p.pay_datetime);
      const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthMap[monthKey] = (monthMap[monthKey] || 0) + p.amount_paid;
    });
    const monthlyRevenueData = Object.entries(monthMap)
      .map(([month, revenue]) => ({ month, revenue, sortKey: new Date(month) }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ month, revenue }) => ({ month, revenue }));

    // --- PAYMENT METHOD & REFUNDS ---
    const methodMap = {};
    const refunds = [];
    paymentsInRange.forEach(p => {
      if (!activeBookingIds.has(p.booking_id)) return;
      if (p.amount_paid < 0) {
        refunds.push(p);
        return;
      }
      const method = p.pay_method || 'Unspecified';
      if (!methodMap[method]) methodMap[method] = { method, count: 0, total: 0 };
      methodMap[method].count += 1;
      methodMap[method].total += p.amount_paid;
    });
    const paymentMethodData = Object.values(methodMap).sort((a, b) => b.total - a.total);
    const totalRefunded = refunds.reduce((sum, r) => sum + Math.abs(r.amount_paid), 0);

    // --- BOOKING FUNNEL (by submission date) ---
    const statusCounts = {};
    bookingsInSubmitRange.forEach(b => {
      statusCounts[b.booking_status] = (statusCounts[b.booking_status] || 0) + 1;
    });
    const totalSubmitted = bookingsInSubmitRange.length;
    const cancelledCount = (statusCounts['Rejected'] || 0) + (statusCounts['Cancelled'] || 0);
    const cancellationRate = totalSubmitted > 0 ? Math.round((cancelledCount / totalSubmitted) * 1000) / 10 : 0;

    // --- MENU PERFORMANCE (packages) ---
    const packageMap = {};
    activeBookingsInRange.filter(b => b.booking_type === 'Package' && b.package_id).forEach(b => {
      const pkgId = b.package_id;
      if (!packageMap[pkgId]) {
        packageMap[pkgId] = { name: b.package?.pkg_name || 'Unknown', type: 'Package', orders: 0, revenue: 0, packageId: pkgId };
      }
      packageMap[pkgId].orders += 1;
      packageMap[pkgId].revenue += b.total_amount || 0;
    });

    // --- MENU PERFORMANCE (short order items) ---
    const menuItemMap = {};
    const menuItemLookup = Object.fromEntries(menuItems.map(m => [m.menu_item_id, m]));
    activeBookingsInRange.filter(b => b.booking_type === 'Short Order').forEach(b => {
      let selections = [];
      try {
        if (b.menu_selections) {
          selections = typeof b.menu_selections === 'string' ? JSON.parse(b.menu_selections) : (Array.isArray(b.menu_selections) ? b.menu_selections : []);
        }
      } catch {
        selections = [];
      }
      selections.forEach(sel => {
        const itemId = sel.menu_item_id;
        const qty = sel.quantity || 1;
        const menuItem = menuItemLookup[itemId];
        const price = menuItem?.menu_price || 0;
        const name = menuItem?.menu_name || 'Unknown Item';
        if (!menuItemMap[itemId]) menuItemMap[itemId] = { name, type: 'Menu Item', orders: 0, quantity: 0, revenue: 0 };
        menuItemMap[itemId].orders += 1;
        menuItemMap[itemId].quantity += qty;
        menuItemMap[itemId].revenue += price * qty;
      });
    });

    const combinedMenuPerf = [
      ...Object.values(packageMap).map(pkg => ({ ...pkg, quantity: pkg.orders })),
      ...Object.values(menuItemMap),
    ].sort((a, b) => b.revenue - a.revenue);

    const maxRevenue = combinedMenuPerf.length > 0 ? Math.max(...combinedMenuPerf.map(d => d.revenue)) : 1;
    const menuPerformanceData = combinedMenuPerf.map((item, index) => ({
      id: `PERF-${index + 1}`,
      name: item.name,
      type: item.type,
      performance: Math.round((item.revenue / maxRevenue) * 100),
      totalOrders: item.orders,
      quantity: item.quantity || item.orders,
      revenueGenerated: item.revenue,
      status: item.revenue < maxRevenue * 0.1 ? 'warning' : 'good',
    }));

    // --- CATEGORY POPULARITY ---
    // Each Package booking's package may span several categories; a booking
    // counts toward every category its package includes.
    const categoriesByPackage = {};
    packageCategories.forEach(row => {
      if (!categoriesByPackage[row.package_id]) categoriesByPackage[row.package_id] = [];
      categoriesByPackage[row.package_id].push(row.category_id);
    });
    const categoryNameLookup = Object.fromEntries(categories.map(c => [c.category_id, c.category_name]));
    const categoryCounts = {};
    Object.values(packageMap).forEach(pkg => {
      const catIds = categoriesByPackage[pkg.packageId] || [];
      catIds.forEach(catId => {
        const name = categoryNameLookup[catId] || 'Unknown';
        if (!categoryCounts[name]) categoryCounts[name] = { name, bookings: 0 };
        categoryCounts[name].bookings += pkg.orders;
      });
    });
    const categoryPopularityData = Object.values(categoryCounts).sort((a, b) => b.bookings - a.bookings);

    // --- EQUIPMENT UTILIZATION (live snapshot, not date-filtered) ---
    const deployedMap = {};
    bookingEquipment.forEach(d => {
      deployedMap[d.equipment_id] = (deployedMap[d.equipment_id] || 0) + d.quantity;
    });
    const equipmentUtilizationData = equipment.map(eq => {
      const deployed = deployedMap[eq.equipment_id] || 0;
      const available = eq.quantity_available || 0;
      const damaged = eq.damaged_quantity || 0;
      const maintenance = eq.maintenance_quantity || 0;
      const total = available + deployed + damaged + maintenance;
      return { id: eq.equipment_id, name: eq.eqm_name, total, available, deployed, damaged, maintenance };
    });

    // --- VEHICLE UTILIZATION (live snapshot, not date-filtered) ---
    const activeAssignmentsByVehicle = {};
    vehicleAssignments.filter(v => v.assignment_status === 'Scheduled').forEach(v => {
      activeAssignmentsByVehicle[v.vehicle_id] = (activeAssignmentsByVehicle[v.vehicle_id] || 0) + 1;
    });
    const vehicleUtilizationData = vehicles.map(v => ({
      id: v.vehicle_id,
      plateNumber: v.plate_number,
      type: v.vehicle_type,
      status: v.vehicle_status,
      activeDispatches: activeAssignmentsByVehicle[v.vehicle_id] || 0,
    }));
    const totalVehicles = vehicles.length;
    const dispatchedVehicles = vehicles.filter(v => (activeAssignmentsByVehicle[v.vehicle_id] || 0) > 0).length;

    // --- CUSTOMER INSIGHTS ---
    const customerMap = {};
    activeBookingsInRange.forEach(b => {
      if (!b.customer_id) return;
      const name = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
      if (!customerMap[b.customer_id]) {
        customerMap[b.customer_id] = { customerId: b.customer_id, name, bookings: 0, spend: 0, firstBookingDate: b.book_datetime };
      }
      const entry = customerMap[b.customer_id];
      entry.bookings += 1;
      entry.spend += paymentMap[b.booking_id] || 0;
      if (b.book_datetime && (!entry.firstBookingDate || new Date(b.book_datetime) < new Date(entry.firstBookingDate))) {
        entry.firstBookingDate = b.book_datetime;
      }
    });
    const customerList = Object.values(customerMap);
    const repeatCustomers = customerList.filter(c => c.bookings > 1).length;
    const oneTimeCustomers = customerList.filter(c => c.bookings === 1).length;

    // --- BOOKING SUMMARY (completed events only, by event month) ---
    const monthGroup = {};
    bookingsInEventRange.filter(b => b.booking_status === 'Completed' && b.event_datetime).forEach(b => {
      const date = new Date(b.event_datetime);
      const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (!monthGroup[monthKey]) monthGroup[monthKey] = { bookings: 0, revenue: 0, packageCounts: {} };
      const group = monthGroup[monthKey];
      group.bookings += 1;
      group.revenue += b.total_amount || 0;
      if (b.booking_type === 'Package' && b.package_id) {
        const pkgName = b.package?.pkg_name || 'Unknown';
        group.packageCounts[pkgName] = (group.packageCounts[pkgName] || 0) + 1;
      }
    });
    const bookingSummaryData = Object.entries(monthGroup).map(([month, data], index) => {
      let topPackage = 'None', maxCount = 0;
      Object.entries(data.packageCounts).forEach(([pkg, count]) => {
        if (count > maxCount) { maxCount = count; topPackage = pkg; }
      });
      return { id: `RPT-${index + 1}`, month, bookings: data.bookings, revenue: data.revenue, topPackage };
    });

    return {
      financialSummary, monthlyRevenueData, paymentMethodData, refunds, totalRefunded,
      totalSubmitted, cancellationRate,
      menuPerformanceData, categoryPopularityData,
      equipmentUtilizationData, vehicleUtilizationData, totalVehicles, dispatchedVehicles,
      repeatCustomers, oneTimeCustomers, totalCustomers: customerList.length,
      bookingSummaryData,
    };
  }, [rawData, rangeStart, rangeEnd]);

  const handleCardClick = (type) => {
    if (!derived) return;
    const breakdowns = {
      revenue: { data: derived.financialSummary._revenueBreakdown, title: 'Total Revenue Breakdown' },
      collected: { data: derived.financialSummary._collectedBreakdown, title: 'Collected Payments Breakdown' },
      outstanding: { data: derived.financialSummary._outstandingBreakdown, title: 'Outstanding Balances Breakdown' },
    };
    const entry = breakdowns[type];
    if (!entry) return;
    setDetailModal({ open: true, type, data: entry.data, title: entry.title });
  };

  const closeDetailModal = () => setDetailModal({ open: false, type: null, data: [], title: '' });

  const handleClearFilter = () => {
    setDatePreset('All Time');
    setCustomStart('');
    setCustomEnd('');
  };

  return (
    <div className="space-y-6 relative pb-12 pr-2">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financial & Reports</h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Financial and operational summary of PG's Catering — bookings, payments, menu popularity, and equipment/vehicle usage.
            <span className="block text-xs text-slate-400 mt-1">Financial figures exclude Rejected and Cancelled bookings. Click any card or row for details.</span>
          </p>
        </div>
        <DateRangeFilter
          preset={datePreset}
          customStart={customStart}
          customEnd={customEnd}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onPresetChange={setDatePreset}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          onClear={handleClearFilter}
        />
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-semibold text-sm transition-all duration-200 ${
                activeTab === tab
                  ? 'border-emerald-600 text-emerald-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {isLoading || !derived ? (
        <div className="w-full py-20 flex justify-center items-center text-slate-400 font-medium animate-pulse">
          Loading metrics and database summaries...
        </div>
      ) : (
        <div className="animate-in fade-in duration-200 space-y-6">
          {activeTab === 'Overview' && <OverviewTab derived={derived} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Financial' && <FinancialTab derived={derived} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Menu Performance' && <MenuPerformanceTab derived={derived} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Equipment Utilization' && <EquipmentUtilizationTab derived={derived} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Vehicle Utilization' && <VehicleUtilizationTab derived={derived} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Booking Summary' && <BookingSummaryTab derived={derived} onOpenDetail={openSimpleModal} />}
        </div>
      )}

      <DetailModal detailModal={detailModal} onClose={closeDetailModal} />
      <SimpleDetailModal
        isOpen={simpleModal.open}
        title={simpleModal.title}
        description={simpleModal.description}
        badge={simpleModal.badge}
        fields={simpleModal.fields}
        onClose={closeSimpleModal}
      />
    </div>
  );
}
