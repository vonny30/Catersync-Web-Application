// src/pages/Reports/index.jsx
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabase';
import toast from 'react-hot-toast';
import { getBookingRef, getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET } from './helpers';
import { isUnverifiedPayment } from '../../utils/payments';
import { getPaymentsReceived } from '../../utils/reportMetrics';
import { fetchAllRows } from '../../utils/fetchAllRows';
import { getDispatchWindow } from '../../utils/vehicle';
import { ACTIVE_BOOKING_STATUSES } from '../../utils/bookingStatus';
import { getStockBreakdown } from '../../utils/equipment.jsx';
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
  'Overview', 'Financial', 'Menu & Packages',
  'Equipment Utilization', 'Vehicle Utilization', 'Booking Summary',
];

const CANCELLED_STATUSES = ['Rejected', 'Cancelled'];

// Group-by-month helpers. The KEY is numeric and locale-independent so it
// can be sorted arithmetically; the LABEL is for display only and is never
// parsed back into a Date. Keeping those two jobs in separate values is the
// whole point — a localized string like "Aug 2026" is not a reliable sort
// key, and is not reliably parseable at all outside an English locale.
const monthSortKey = (date) => date.getFullYear() * 12 + date.getMonth();
const monthLabel = (date) => date.toLocaleString('default', { month: 'short', year: 'numeric' });

export default function Reports() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [isLoading, setIsLoading] = useState(true);
  const [rawData, setRawData] = useState(null);

  const [datePreset, setDatePreset] = useState(DEFAULT_DATE_PRESET);
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
  //
  // PostgREST caps every response at 1000 rows by default and returns the
  // truncated set WITHOUT an error. These queries used to run unbounded, so
  // the moment any table passed 1000 rows every figure derived from it went
  // silently wrong — no throw, no warning, just quietly missing data that
  // gets worse as the business grows. (Bookings.jsx and ShortOrders.jsx
  // already paginate; Reports never did.)
  //
  // fetchAll pages through with .range() until a short page comes back.
  // Each caller must supply a stable .order() — Postgres gives no ordering
  // guarantee without ORDER BY, so paging an unordered query can repeat or
  // skip rows between pages. Ordering by primary key is the cheap, safe
  // choice since nothing here depends on the fetch order.
  // Moved to utils/fetchAllRows so Payments can share it rather than grow a
  // second copy — the rules about stable ordering are easy to get subtly
  // wrong and belong in one documented place.
  const fetchAll = (buildQuery) => fetchAllRows(buildQuery, 'Reports');

  const fetchRawData = async () => {
    setIsLoading(true);
    try {
      const [
        bookings, payments, packages, menuItems, categories,
        packageCategories, equipment, bookingEquipment, vehicles, vehicleAssignments,
      ] = await Promise.all([
        fetchAll(() => supabase.from('booking').select(`
          booking_id, booking_number, booking_type, event_datetime, book_datetime,
          total_amount, delivery_fee, booking_status, package_id, customer_id, menu_selections,
          package:package_id (pkg_name, pricing_type),
          customer:customer_id (first_name, last_name)
        `).order('booking_id', { ascending: true })),
        fetchAll(() => supabase.from('payment').select('payment_id, amount_paid, pay_datetime, pay_status, pay_method, booking_id, customer_id').order('payment_id', { ascending: true })),
        fetchAll(() => supabase.from('package').select('*').order('package_id', { ascending: true })),
        fetchAll(() => supabase.from('menu_item').select('*').order('menu_item_id', { ascending: true })),
        fetchAll(() => supabase.from('category').select('*').order('category_id', { ascending: true })),
        fetchAll(() => supabase.from('package_category').select('package_id, category_id').order('package_category_id', { ascending: true })),
        fetchAll(() => supabase.from('equipment').select('equipment_id, eqm_name, quantity_available, damaged_quantity, maintenance_quantity').order('equipment_id', { ascending: true })),
        fetchAll(() => supabase.from('booking_equipment').select('equipment_id, quantity, returned, booking:booking_id (booking_status)').eq('returned', false).order('assignment_id', { ascending: true })),
        fetchAll(() => supabase.from('vehicle').select('vehicle_id, plate_number, vehicle_type, vehicle_status').order('vehicle_id', { ascending: true })),
        // dispatch_datetime plus the booking's event date and type are what
        // getDispatchWindow needs; without them this page could only reason
        // about whether an assignment exists, not when it actually runs.
        fetchAll(() => supabase.from('vehicle_assign').select('vehicle_id, booking_id, assignment_status, dispatch_datetime, booking:booking_id (booking_status, event_datetime, booking_type)').order('assignment_id', { ascending: true })),
      ]);

      setRawData({
        bookings,
        payments,
        packages,
        menuItems,
        categories,
        packageCategories,
        equipment,
        bookingEquipment,
        vehicles,
        vehicleAssignments,
      });
    } catch (error) {
      handleError(error, "Couldn't load the reports. Refresh to try again.");
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

    // Lookup for attaching a booking ref/type to a payment/refund row that
    // only carries booking_id — used so the Refunds panel can link
    // straight to the booking/order it came from.
    const bookingsById = {};
    bookings.forEach(b => { bookingsById[b.booking_id] = b; });

    // Bookings whose EVENT falls in range (revenue/menu/summary anchor).
    const bookingsInEventRange = bookings.filter(b => !rangeStart && !rangeEnd ? true : isWithinRange(b.event_datetime, rangeStart, rangeEnd));
    // Bookings SUBMITTED in range (funnel/customer-acquisition anchor).
    const bookingsInSubmitRange = bookings.filter(b => !rangeStart && !rangeEnd ? true : isWithinRange(b.book_datetime, rangeStart, rangeEnd));

    // Pending Verification / Proof Rejected rows aren't real collected money
    // yet — matches sumVerifiedPositivePayments' definition used everywhere
    // else in the app (booking detail pages, Payments.jsx), so "Revenue
    // Collected" here means the same thing it means there.
    const verifiedPayments = payments.filter(p => !isUnverifiedPayment(p));
    // Payments RECEIVED in range.
    const paymentsInRange = verifiedPayments.filter(p => !rangeStart && !rangeEnd ? true : isWithinRange(p.pay_datetime, rangeStart, rangeEnd));

    const activeBookingsInRange = bookingsInEventRange.filter(b => !CANCELLED_STATUSES.includes(b.booking_status));
    const activeBookingIds = new Set(activeBookingsInRange.map(b => b.booking_id));
    // A Pending row is an enquiry PG's has not accepted, but it still carries a
    // total_amount and so still lands in Contract Value. The figure stays as it
    // is — these three cards are a tied set, contractValue - paidAgainstEvents
    // = outstandingBalance, and FinancialTab prints that division on screen —
    // so the count is disclosed in the sub-line instead of being subtracted.
    const pendingInRangeCount = activeBookingsInRange.filter(b => b.booking_status === 'Pending').length;

    // --- FINANCIAL ---
    const paymentMap = {};
    verifiedPayments.forEach(p => {
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
        const paymentDetails = verifiedPayments.filter(p => p.booking_id === b.booking_id && activeBookingIds.has(p.booking_id));
        collectedBreakdown.push({ ...bookingInfo, paymentDetails });
      }
      if (outstanding > 0) outstandingBreakdown.push(bookingInfo);
    });

    // Cash actually received during the period, anchored on pay_datetime —
    // a different question from the three figures above, which are anchored on
    // the event date. Both belong on the Financial tab; conflating them is what
    // made this page disagree with the Dashboard.
    const bookingStatusById = {};
    bookings.forEach(b => { bookingStatusById[b.booking_id] = b.booking_status; });
    const received = getPaymentsReceived(payments, {
      start: rangeStart, end: rangeEnd, bookingStatusById,
    });

    const financialSummary = {
      contractValue: totalContractValue,
      paidAgainstEvents: totalCollected,
      outstanding: totalOutstanding,
      // Panel PR-38: the headline counts Confirmed and Completed only. The
      // other two are carried alongside so the tab can show what it excludes
      // instead of leaving a manager to wonder where the difference went.
      revenueReceived: received.revenueReceived,
      awaitingConfirmation: received.awaitingConfirmation,
      paymentsReceived: received.paymentsReceived,
      retainedFromCancellations: received.retainedFromCancellations,
      refundsIssued: received.refundsIssued,
      // Refunds actually netted out of paymentsReceived -- NOT refundsIssued.
      // The distinction and its reasoning now live with the derivation, in
      // getPaymentsReceived; Payments.jsx reads the same field.
      refundsNettedAgainstReceived: received.refundsNettedAgainstReceived,
      _revenueBreakdown: revenueBreakdown,
      _collectedBreakdown: collectedBreakdown,
      _outstandingBreakdown: outstandingBreakdown,
    };

    // Monthly revenue (payments actually received in range).
    //
    // Months are grouped by a NUMERIC key and sorted on it. The previous
    // version grouped by the display string ("Aug 2026") and then sorted by
    // re-parsing it with new Date("Aug 2026") — parsing a format like that
    // is implementation-defined in JavaScript, so it only worked by luck.
    // Under a non-English browser locale toLocaleString emits "ago 2026" /
    // "8月 2026", new Date() returns Invalid Date, the comparator gets NaN,
    // and the chart renders its months in arbitrary order. The label is now
    // kept purely for display and never parsed back.
    // Built from exactly the rows the Total Collections card counts, so the
    // chart and the card above it always add up to the same number.
    //
    // This previously skipped `amount_paid <= 0`, which meant refunds never
    // pulled a bar down while the caption claimed the figure was net of them.
    // Negative rows are now included: a month can legitimately go negative if
    // more was refunded than taken, and hiding that was the whole problem.
    // It also used to filter on activeBookingIds — bookings whose EVENT fell in
    // range — which quietly mixed the event-anchored basis into a chart that is
    // anchored on the payment date.
    const monthMap = {};
    received.activeRows.forEach(p => {
      if (!p.pay_datetime) return;
      const date = new Date(p.pay_datetime);
      const sortKey = monthSortKey(date);
      if (!monthMap[sortKey]) monthMap[sortKey] = { month: monthLabel(date), revenue: 0, sortKey };
      monthMap[sortKey].revenue += (p.amount_paid || 0);
    });
    const monthlyRevenueData = Object.values(monthMap)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ month, revenue }) => ({ month, revenue }));

    // --- PAYMENT METHOD & REFUNDS ---
    const methodMap = {};
    const refunds = [];
    paymentsInRange.forEach(p => {
      if (p.amount_paid < 0) {
        // Refunds happen almost exclusively when a booking is Rejected or
        // Cancelled (see useRejectionHandlers.js / useCancellationHandlers.js
        // — the refund row is inserted in the same action that sets the
        // booking to that status). Applying the "active bookings only"
        // filter here excluded a refund the instant its own booking left
        // active status, which is precisely when almost every refund
        // exists — the Refunds panel was silently dropping nearly all of
        // them. Refunds are tracked regardless of the booking's current
        // status; only the Payment Methods breakdown below stays
        // active-bookings-only.
        const refundBooking = bookingsById[p.booking_id];
        refunds.push({
          ...p,
          bookingRef: refundBooking ? getBookingRef(refundBooking) : null,
          bookingType: refundBooking?.booking_type || 'Package',
        });
        return;
      }
      if (!activeBookingIds.has(p.booking_id)) return;
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
    // Rejected (PG's declined the work) and Cancelled (the customer withdrew)
    // are opposite business events. One combined rate is still the right
    // headline — both end in no event — but which one is driving it is the
    // actionable part, so the drill-down names them separately.
    const rejectedCount = statusCounts['Rejected'] || 0;
    const customerCancelledCount = statusCounts['Cancelled'] || 0;
    const cancelledCount = rejectedCount + customerCancelledCount;
    const cancellationRate = totalSubmitted > 0 ? Math.round((cancelledCount / totalSubmitted) * 1000) / 10 : 0;

    // ============================================================
    // --- PRODUCT MIX ---
    // A package and a menu item are not the same kind of quantity. A package
    // is sold once per event at price x pax; a menu item is sold by the tray.
    // Ranking them in one list makes every tray look like a failure next to
    // any package, and the old share (revenue / biggest row's revenue) made
    // the top row read exactly 100% no matter what it actually sold — a bar
    // that means "this one is largest" but reads as "this is all of it".
    //
    // So each set is measured against its OWN total. Every share column below
    // adds up to 100%, which is what makes a percentage here worth reading.
    // ============================================================
    const packageBookings = activeBookingsInRange.filter(b => b.booking_type === 'Package' && b.package_id);
    const shortOrderBookings = activeBookingsInRange.filter(b => b.booking_type === 'Short Order');

    const sumTotalAmount = rows => rows.reduce((sum, b) => sum + (b.total_amount || 0), 0);
    const packageRevenue = sumTotalAmount(packageBookings);
    const shortOrderRevenue = sumTotalAmount(shortOrderBookings);
    const combinedRevenue = packageRevenue + shortOrderRevenue;

    // Attaches share-of-total columns to a list already sorted by revenue.
    // cumulativeShare is the running total down the list — where it crosses
    // 80% is the line between what the business actually runs on and the tail
    // worth reviewing. countKey lets the "how often" column be bookings for
    // packages and trays for menu items, since those are the units each is
    // really ordered in.
    const withShares = (rows, totalRevenue, totalCount, countKey = 'count') => {
      let running = 0;
      return rows.map((row, index) => {
        const revenueShare = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
        running += revenueShare;
        return {
          ...row,
          rank: index + 1,
          revenueShare,
          countShare: totalCount > 0 ? ((row[countKey] || 0) / totalCount) * 100 : 0,
          cumulativeShare: running,
        };
      });
    };

    // The one place packages and short orders belong in the same table:
    // here they genuinely are two parts of one whole.
    const productLineMix = [
      { key: 'Package', name: 'Packages', count: packageBookings.length, revenue: packageRevenue },
      { key: 'Short Order', name: 'Short Orders', count: shortOrderBookings.length, revenue: shortOrderRevenue },
    ].map(line => ({
      ...line,
      revenueShare: combinedRevenue > 0 ? (line.revenue / combinedRevenue) * 100 : 0,
    }));

    // --- PACKAGE MIX (each package against all package revenue) ---
    const packageMap = {};
    packageBookings.forEach(b => {
      const pkgId = b.package_id;
      if (!packageMap[pkgId]) {
        packageMap[pkgId] = { id: pkgId, packageId: pkgId, name: b.package?.pkg_name || 'Unknown', count: 0, revenue: 0 };
      }
      packageMap[pkgId].count += 1;
      packageMap[pkgId].revenue += b.total_amount || 0;
    });
    const packageMix = withShares(
      Object.values(packageMap).sort((a, b) => b.revenue - a.revenue),
      packageRevenue,
      packageBookings.length,
    );

    // --- MENU ITEM MIX (each item against all menu-item revenue) ---
    // A SHORT ORDER's menu_selections stores only {menu_item_id, quantity} —
    // there is no price snapshot — so a line has to start from today's
    // menu_price. (A package's menu_selections is a different shape entirely:
    // an object keyed by category_id. This block only ever walks short orders,
    // but see mobile-contract.md §5.1 before reusing the assumption.) Left there,
    // raising a price would silently restate last year's revenue and the item
    // totals would never add up to what customers actually paid.
    //
    // Instead each order's food revenue (total_amount minus its delivery fee)
    // is allocated across its lines in proportion to price x quantity. Item
    // revenues then sum to real money received, and any approval-time fee
    // adjustment is carried along with them. Tray counts are exact either way
    // — which is why the tab ranks by trays as well as by pesos.
    const menuItemMap = {};
    const menuItemLookup = Object.fromEntries(menuItems.map(m => [m.menu_item_id, m]));
    let deliveryFeeTotal = 0;
    // Food money from short orders whose menu_selections could not be read, so
    // it belongs to no dish. Tracked rather than dropped so the footer's three
    // figures actually add up.
    let unattributedFoodRevenue = 0;
    let hasEstimatedMenuRevenue = false;

    shortOrderBookings.forEach(b => {
      let selections = [];
      try {
        if (b.menu_selections) {
          selections = typeof b.menu_selections === 'string' ? JSON.parse(b.menu_selections) : (Array.isArray(b.menu_selections) ? b.menu_selections : []);
        }
      } catch {
        selections = [];
      }
      // The delivery fee is counted BEFORE the early return, not after. A short
      // order with no readable menu_selections still charged a delivery fee and
      // its total_amount is still inside shortOrderRevenue below — dropping its
      // fee here left the footer printing "menu items + delivery fees" over a
      // rule line and a short order revenue total larger than their sum, with
      // the difference unexplained.
      const deliveryFee = b.delivery_fee || 0;
      deliveryFeeTotal += deliveryFee;

      if (selections.length === 0) {
        // Nothing to attribute to a dish, but the food money is real, so keep
        // it out of the menu table and let the footer account for it.
        unattributedFoodRevenue += Math.max(0, (b.total_amount || 0) - deliveryFee);
        return;
      }

      const foodRevenue = Math.max(0, (b.total_amount || 0) - deliveryFee);

      const lines = selections.map(sel => {
        const menuItem = menuItemLookup[sel.menu_item_id];
        const quantity = sel.quantity || 1;
        return {
          itemId: sel.menu_item_id,
          name: menuItem?.menu_name || 'Unknown item',
          quantity,
          listValue: (menuItem?.menu_price || 0) * quantity,
        };
      });
      const orderListValue = lines.reduce((sum, line) => sum + line.listValue, 0);
      // Nothing to allocate in proportion to — every item on the order was
      // deleted from the menu, or priced at zero. Fall back to list value and
      // flag it, rather than inventing a split.
      const canAllocate = orderListValue > 0 && foodRevenue > 0;
      if (!canAllocate) hasEstimatedMenuRevenue = true;

      lines.forEach(line => {
        if (!menuItemMap[line.itemId]) {
          menuItemMap[line.itemId] = { id: line.itemId, name: line.name, count: 0, quantity: 0, revenue: 0 };
        }
        const entry = menuItemMap[line.itemId];
        entry.count += 1;
        entry.quantity += line.quantity;
        entry.revenue += canAllocate ? foodRevenue * (line.listValue / orderListValue) : line.listValue;
      });
    });

    const menuItemList = Object.values(menuItemMap);
    const menuItemRevenue = menuItemList.reduce((sum, item) => sum + item.revenue, 0);
    const traysSold = menuItemList.reduce((sum, item) => sum + item.quantity, 0);
    const menuItemMix = withShares(
      menuItemList.sort((a, b) => b.revenue - a.revenue),
      menuItemRevenue,
      traysSold,
      'quantity',
    );
    // The most-ordered item and the highest-earning item are usually not the
    // same item. One column can never show both, which is exactly what the
    // old single "Popularity Metric" column tried to do.
    const topSellingItem = [...menuItemMix].sort((a, b) => b.quantity - a.quantity)[0] || null;

    // --- CATEGORY DEMAND ---
    // One package spans several categories, so a booking counts toward every
    // category its package includes. That makes categories impossible to
    // express as shares of each other — these counts deliberately add up to
    // more than the number of bookings. The honest denominator is the number
    // of package bookings: a category included in every booking reads 100%,
    // one in a quarter of them reads 25%.
    const categoriesByPackage = {};
    packageCategories.forEach(row => {
      if (!categoriesByPackage[row.package_id]) categoriesByPackage[row.package_id] = [];
      categoriesByPackage[row.package_id].push(row.category_id);
    });
    const categoryNameLookup = Object.fromEntries(categories.map(c => [c.category_id, c.category_name]));
    const categoryCounts = {};
    packageMix.forEach(pkg => {
      const catIds = categoriesByPackage[pkg.packageId] || [];
      catIds.forEach(catId => {
        const name = categoryNameLookup[catId] || 'Unknown';
        if (!categoryCounts[name]) categoryCounts[name] = { name, bookings: 0 };
        categoryCounts[name].bookings += pkg.count;
      });
    });
    const totalPackageBookings = packageBookings.length;
    const categoryDemandData = Object.values(categoryCounts)
      .map(cat => ({ ...cat, share: totalPackageBookings > 0 ? (cat.bookings / totalPackageBookings) * 100 : 0 }))
      .sort((a, b) => b.bookings - a.bookings);

    // --- EQUIPMENT UTILIZATION (live snapshot, not date-filtered) ---
    // Only counts gear tied to a booking that's actually Approved/Confirmed
    // right now — matches how Equipment.jsx's own availability view defines
    // "committed", so this number doesn't disagree with what that page
    // shows for the same equipment.
    const deployedMap = {};
    bookingEquipment
      .filter(d => d.booking?.booking_status && ACTIVE_BOOKING_STATUSES.includes(d.booking.booking_status))
      .forEach(d => {
        deployedMap[d.equipment_id] = (deployedMap[d.equipment_id] || 0) + d.quantity;
      });
    // `quantity_available` already means USABLE units — it is not reduced when
    // gear is assigned to a booking, because commitments live in
    // booking_equipment and are per date. Adding `deployed` back into the total
    // therefore counted every committed unit twice and inflated the fleet size,
    // which in turn understated utilisation. getStockBreakdown owns the
    // identity: total = usable + out of service.
    const equipmentUtilizationData = equipment.map(eq => {
      const deployed = deployedMap[eq.equipment_id] || 0;
      const { total, usable, damaged, maintenance, outOfService } = getStockBreakdown(eq);
      return {
        id: eq.equipment_id,
        name: eq.eqm_name,
        total,
        usable,
        deployed,
        // Free right now: usable stock that isn't already promised out.
        free: usable - deployed,
        damaged,
        maintenance,
        outOfService,
      };
    });

    // --- VEHICLE UTILIZATION (live snapshot, not date-filtered) ---
    // Same cross-check Vehicles.jsx itself applies: a Scheduled assignment
    // only counts as "really active" if the booking it's tied to is still
    // Approved/Confirmed — otherwise a vehicle scheduled for a since-
    // rejected/cancelled booking would keep showing as dispatched here even
    // though Vehicles.jsx no longer treats it that way.
    const activeAssignmentsByVehicle = {};
    vehicleAssignments
      .filter(v => v.assignment_status === 'Scheduled' && v.booking?.booking_status && ACTIVE_BOOKING_STATUSES.includes(v.booking.booking_status))
      .forEach(v => {
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

    // D8. "Currently dispatched" used to count any vehicle holding a Scheduled
    // assignment on an active booking — which includes a van booked for a
    // wedding three weeks out. That is committed, not dispatched. A vehicle is
    // ON THE ROAD only while a dispatch window actually contains this moment.
    const nowInstant = new Date();
    const liveAssignments = vehicleAssignments.filter(v =>
      v.assignment_status === 'Scheduled'
      && v.booking?.booking_status
      && ACTIVE_BOOKING_STATUSES.includes(v.booking.booking_status)
    );
    const dispatchedVehicleIds = new Set(
      liveAssignments
        .filter(v => {
          const w = getDispatchWindow(v, v.booking);
          return w ? (w.start <= nowInstant && nowInstant <= w.end) : false;
        })
        .map(v => v.vehicle_id)
    );
    const dispatchedVehicles = dispatchedVehicleIds.size;
    // Kept separately, because "booked" is a real and different question from
    // "out right now" and the page shows both.
    const committedVehicles = vehicles.filter(v => (activeAssignmentsByVehicle[v.vehicle_id] || 0) > 0).length;

    // Fleet utilization as a share of a whole, per Blueprint 02 §4: the hours
    // vehicles actually spent on the road inside the reporting range, over the
    // hours the fleet had available across that range.
    //
    // Only vehicles in service count toward the denominator — a van sitting in
    // the workshop was never available to dispatch, so including it would
    // report the fleet as idle when it was simply smaller.
    //
    // Needs a bounded range. Over "All Time" there is no finite denominator,
    // so the figure is reported as unavailable rather than invented.
    const HOUR = 60 * 60 * 1000;
    // Vehicles actually fit to go out. Reported on its own because
    // "available" previously meant total minus dispatched, which counted a van
    // sitting in the workshop as free.
    const serviceableVehicles = vehicles.filter(v => v.vehicle_status === 'Available').length;
    let fleetUtilization = null;
    if (rangeStart && rangeEnd && serviceableVehicles > 0) {
      const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
      if (rangeMs > 0) {
        // Every dispatch in the range, returned ones included: hours spent are
        // hours spent whether or not the trip has since closed.
        const dispatchedMs = vehicleAssignments
          .filter(v => v.booking?.booking_status && !CANCELLED_STATUSES.includes(v.booking.booking_status))
          .reduce((sum, v) => {
            const w = getDispatchWindow(v, v.booking);
            if (!w) return sum;
            const from = Math.max(w.start.getTime(), rangeStart.getTime());
            const to = Math.min(w.end.getTime(), rangeEnd.getTime());
            return sum + Math.max(0, to - from);
          }, 0);
        const availableMs = serviceableVehicles * rangeMs;
        fleetUtilization = {
          percent: (dispatchedMs / availableMs) * 100,
          dispatchedHours: dispatchedMs / HOUR,
          availableHours: availableMs / HOUR,
          serviceableVehicles,
        };
      }
    }

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
    // Same numeric-key grouping as monthlyRevenueData above, and sorted
    // newest-first. This list was previously left in whatever order the
    // object keys happened to land in — which is the order bookings were
    // encountered, not chronological. That mattered twice over: the Booking
    // Summary tab listed months in an arbitrary order, and the Financial
    // tab's panel does .slice(0, 3) on this array, so it was showing three
    // arbitrary months while being titled a summary of the recent ones.
    const monthGroup = {};
    bookingsInEventRange.filter(b => b.booking_status === 'Completed' && b.event_datetime).forEach(b => {
      const date = new Date(b.event_datetime);
      const sortKey = monthSortKey(date);
      if (!monthGroup[sortKey]) monthGroup[sortKey] = { month: monthLabel(date), sortKey, bookings: 0, revenue: 0, packageCounts: {} };
      const group = monthGroup[sortKey];
      group.bookings += 1;
      group.revenue += b.total_amount || 0;
      if (b.booking_type === 'Package' && b.package_id) {
        const pkgName = b.package?.pkg_name || 'Unknown';
        group.packageCounts[pkgName] = (group.packageCounts[pkgName] || 0) + 1;
      }
    });
    const bookingSummaryData = Object.values(monthGroup)
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((data, index) => {
        let topPackage = 'None', maxCount = 0;
        Object.entries(data.packageCounts).forEach(([pkg, count]) => {
          if (count > maxCount) { maxCount = count; topPackage = pkg; }
        });
        return { id: `RPT-${index + 1}`, month: data.month, bookings: data.bookings, revenue: data.revenue, topPackage };
      });

    return {
      financialSummary, monthlyRevenueData, paymentMethodData, refunds, totalRefunded,
      totalSubmitted, cancellationRate, rejectedCount, customerCancelledCount, pendingInRangeCount,
      committedVehicles, fleetUtilization, serviceableVehicles,
      productLineMix, packageMix, menuItemMix, categoryDemandData,
      packageRevenue, shortOrderRevenue, combinedRevenue,
      menuItemRevenue, deliveryFeeTotal, unattributedFoodRevenue, traysSold, topSellingItem,
      hasEstimatedMenuRevenue, totalPackageBookings,
      equipmentUtilizationData, vehicleUtilizationData, totalVehicles, dispatchedVehicles,
      repeatCustomers, oneTimeCustomers, totalCustomers: customerList.length,
      bookingSummaryData,
    };
  }, [rawData, rangeStart, rangeEnd]);

  const handleCardClick = (type) => {
    if (!derived) return;
    const breakdowns = {
      revenue: { data: derived.financialSummary._revenueBreakdown, title: 'Contract Value — events in this period' },
      collected: { data: derived.financialSummary._collectedBreakdown, title: 'Paid against these events' },
      outstanding: { data: derived.financialSummary._outstandingBreakdown, title: 'Unpaid on These Events' },
    };
    const entry = breakdowns[type];
    if (!entry) return;
    setDetailModal({ open: true, type, data: entry.data, title: entry.title });
  };

  const closeDetailModal = () => setDetailModal({ open: false, type: null, data: [], title: '' });

  const handleClearFilter = () => {
    setDatePreset(DEFAULT_DATE_PRESET);
    setCustomStart('');
    setCustomEnd('');
  };

  return (
    <div className="space-y-[18px] relative pb-12 pr-2">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Reports</h1>
          {/* One sentence at one size. The old version nested a 12px grey line
              inside a 14px grey paragraph, and "click any card for details" is
              an instruction for an affordance the cards already carry. The
              exclusion is kept -- it changes what the figures mean. */}
          <p className="text-[14.5px] text-slate-600 mt-1.5 max-w-[620px] [text-wrap:pretty]">
            Bookings, payments, menu popularity, and equipment usage for PG's Catering. Figures exclude rejected and cancelled bookings.
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

      <div className="border-b border-slate-200/80">
        <nav className="-mb-px flex gap-0.5 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap px-[15px] py-[11px] border-b-2 text-[14.5px] transition-colors ${
                activeTab === tab
                  ? 'border-[#008A45] text-[#007038] font-bold'
                  : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {isLoading || !derived ? (
        <div className="w-full py-20 flex justify-center items-center text-slate-500 font-medium">
          Loading metrics and database summaries...
        </div>
      ) : (
        <div className="animate-in fade-in duration-200 space-y-[18px]">
          {activeTab === 'Overview' && <OverviewTab derived={derived} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Financial' && <FinancialTab derived={derived} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Menu & Packages' && <MenuPerformanceTab derived={derived} onOpenDetail={openSimpleModal} />}
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
