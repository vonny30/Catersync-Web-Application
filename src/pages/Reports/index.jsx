// src/pages/Reports/index.jsx
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabase';
import toast from 'react-hot-toast';
import {
  getBookingRef, getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET, periodLabel, periodTitle, periodSpan, paymentsReceivedNet,
  monthSortKey, monthLabel, buildMonthlyFinancialTrend,
} from './helpers';
import { movesBooks, isRefundEntry, isReversalEntry } from '../../utils/payments';
import { fetchAllRows } from '../../utils/fetchAllRows';
import DateRangeFilter from './DateRangeFilter';
import { FilterBar, FilterField, PeriodTitle } from '../../components/FilterBar';
import DetailModal from './DetailModal';
import SimpleDetailModal from './SimpleDetailModal';
import OverviewTab from './OverviewTab';
import FinancialTab from './FinancialTab';
import MenuPerformanceTab from './MenuPerformanceTab';
import BookingSummaryTab from './BookingSummaryTab';

const TABS = ['Overview', 'Financial', 'Menu & Packages', 'Booking Summary'];

const CANCELLED_STATUSES = ['Rejected', 'Cancelled'];
// Work nobody has agreed to. A Pending request is a lead, not a sale: it is in
// no revenue figure on the Financial tab, and it must not inflate product
// popularity or projected revenue on Menu & Packages either.
const UNACCEPTED_STATUSES = [...CANCELLED_STATUSES, 'Pending'];

// Group-by-month helpers. The KEY is numeric and locale-independent so it
// can be sorted arithmetically; the LABEL is for display only and is never
// parsed back into a Date. Keeping those two jobs in separate values is the
// whole point — a localized string like "Aug 2026" is not a reliable sort
// key, and is not reliably parseable at all outside an English locale.

export default function Reports() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [isLoading, setIsLoading] = useState(true);
  const [rawData, setRawData] = useState(null);

  const [datePreset, setDatePreset] = useState(DEFAULT_DATE_PRESET);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // The whole financial block for the selected period, from the database:
  // one call to f_report_period. Nothing on this page adds money up.
  const [periodTotals, setPeriodTotals] = useState(null);
  const [totalsError, setTotalsError] = useState(false);

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
        bookings, payments, bookingMoney, packages, menuItems, categories,
        packageCategories,
      ] = await Promise.all([
        fetchAll(() => supabase.from('booking').select(`
          booking_id, booking_number, booking_type, event_datetime, book_datetime,
          total_amount, delivery_fee, booking_status, package_id, customer_id, menu_selections,
          package:package_id (pkg_name, pricing_type),
          customer:customer_id (first_name, last_name)
        `).order('booking_id', { ascending: true })),
        // v_payment_ledger, not the payment table: counts_in_ledger is what
        // decides whether an entry moves the books (a reversal and the receipt
        // it cancels both stop counting), and entry_type is what separates a
        // refund from a reversal. Neither is derivable from the raw rows.
        fetchAll(() => supabase.from('v_payment_ledger').select('payment_id, amount_paid, pay_datetime, pay_status, pay_method, booking_id, customer_id, entry_type, counts_in_ledger, booking_number, booking_type').order('payment_id', { ascending: true })),
        // Per-booking money, already netted by the database. The breakdown
        // lists read these columns rather than re-deriving paid/outstanding.
        fetchAll(() => supabase.from('v_booking_money').select('booking_id, booking_number, booking_type, booking_status, event_datetime, total_amount, net_paid, outstanding, is_receivable, is_closed, counts_toward_revenue, customer:customer_id (first_name, last_name)').order('booking_id', { ascending: true })),
        fetchAll(() => supabase.from('package').select('*').order('package_id', { ascending: true })),
        fetchAll(() => supabase.from('menu_item').select('*').order('menu_item_id', { ascending: true })),
        fetchAll(() => supabase.from('category').select('*').order('category_id', { ascending: true })),
        fetchAll(() => supabase.from('package_category').select('package_id, category_id').order('package_category_id', { ascending: true })),
      ]);

      setRawData({
        bookings,
        payments,
        bookingMoney,
        packages,
        menuItems,
        categories,
        packageCategories,
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
  const period = periodLabel(datePreset, rangeStart, rangeEnd);
  // The exact days, for card subtexts ("September 1–30"); null for All time.
  const span = periodSpan(rangeStart, rangeEnd);

  // One call, one row, every headline figure — event-anchored and
  // payment-anchored alike, all of it computed in the database against
  // counts_in_ledger. Re-run whenever the period changes. Serialized bounds
  // as the dependency, since getRangeBounds returns fresh Date objects.
  const rangeKey = `${rangeStart ? rangeStart.toISOString() : ''}|${rangeEnd ? rangeEnd.toISOString() : ''}`;
  useEffect(() => {
    let ignore = false;
    (async () => {
      const [startISO, endISO] = rangeKey.split('|');
      const { data, error } = await supabase.rpc('f_report_period', {
        p_start: startISO || null,
        p_end: endISO || null,
      });
      if (ignore) return;
      if (error) {
        console.error('f_report_period failed:', error);
        setTotalsError(true);
        setPeriodTotals(null);
        toast.error("Couldn't load the period totals. Refresh to try again.");
        return;
      }
      setTotalsError(false);
      setPeriodTotals(Array.isArray(data) ? data[0] : data);
    })();
    return () => { ignore = true; };
  }, [rangeKey]);

  // ========== DERIVE EVERYTHING FROM RAW DATA + DATE RANGE ==========
  const derived = useMemo(() => {
    if (!rawData) return null;

    const { bookings, payments, bookingMoney, menuItems, categories, packageCategories } = rawData;

    // Lookup for attaching a booking ref/type to a payment/refund row that
    // only carries booking_id — used so the Refunds panel can link
    // straight to the booking/order it came from.
    const bookingsById = {};
    bookings.forEach(b => { bookingsById[b.booking_id] = b; });

    // Bookings whose EVENT falls in range (revenue/menu/summary anchor).
    const bookingsInEventRange = bookings.filter(b => !rangeStart && !rangeEnd ? true : isWithinRange(b.event_datetime, rangeStart, rangeEnd));

    // Entries that move the books, read from the ledger view: not unverified
    // claims, not reversals, not receipts that have been reversed. movesBooks
    // reads counts_in_ledger; it is never re-derived here.
    const countedEntries = payments.filter(movesBooks);
    const countedInRange = countedEntries.filter(p => !rangeStart && !rangeEnd ? true : isWithinRange(p.pay_datetime, rangeStart, rangeEnd));
    const entriesInRange = payments.filter(p => !rangeStart && !rangeEnd ? true : isWithinRange(p.pay_datetime, rangeStart, rangeEnd));

    // Accepted work only — Approved, Confirmed, Completed. This list feeds the
    // product mix and the customer panels; excluding Pending keeps both on the
    // same revenue-recognition basis as every money figure on this page.
    const acceptedBookingsInRange = bookingsInEventRange.filter(b => !UNACCEPTED_STATUSES.includes(b.booking_status));

    // --- FINANCIAL ---
    //
    // Every headline figure comes from f_report_period (periodTotals). Nothing
    // is summed here: the database owns the money definitions, and the two
    // pages that show them must read the same ones. The lists below are the
    // ROWS behind those figures, taken from v_booking_money as-is — each row's
    // total, paid and outstanding are the view's own columns.
    const moneyInEventRange = bookingMoney.filter(m => !rangeStart && !rangeEnd ? true : isWithinRange(m.event_datetime, rangeStart, rangeEnd));
    // What each booking has actually taken, from the view's own column.
    const netPaidByBooking = Object.fromEntries(bookingMoney.map(m => [m.booking_id, Number(m.net_paid) || 0]));
    const breakdownRow = (m) => ({
      id: m.booking_id,
      bookingRef: m.booking_number || getBookingRef({ booking_id: m.booking_id, booking_type: m.booking_type }),
      customer: m.customer ? `${m.customer.first_name} ${m.customer.last_name}` : 'Unknown',
      eventDate: m.event_datetime,
      total: Number(m.total_amount) || 0,
      paid: Number(m.net_paid) || 0,
      outstanding: Number(m.outstanding) || 0,
      status: m.booking_status,
      type: m.booking_type || 'Package',
    });
    // A cancelled or rejected booking counts only for the deposit it kept:
    // total and paid are the retained amount, and nothing is owed on it.
    const keptDepositRow = (m) => ({
      ...breakdownRow(m),
      total: Number(m.net_paid) || 0,
      outstanding: 0,
    });

    const financialSummary = {
      // Event-anchored, by service date.
      grossContracted: Number(periodTotals?.gross_contracted) || 0,
      grossApproved: Number(periodTotals?.gross_approved) || 0,
      grossTotalAccepted: Number(periodTotals?.gross_total_accepted) || 0,
      outstandingReceivable: Number(periodTotals?.outstanding_receivable) || 0,
      outstandingContracted: Number(periodTotals?.outstanding_contracted) || 0,
      // TWO SIMILAR COLUMNS, and the difference matters.
      //   paid_contracted      — Confirmed + Completed, the SAME population as
      //                          Estimated Gross Revenue. This is the one the
      //                          bridge card shows, and it is what makes
      //                          collections + receivables = revenue hold.
      //   paid_against_events  — adds Approved. Kept for reference only.
      paidContracted: Number(periodTotals?.paid_contracted) || 0,
      paidAgainstEvents: Number(periodTotals?.paid_against_events) || 0,
      completedCount: Number(periodTotals?.completed_count) || 0,
      contractedCount: Number(periodTotals?.contracted_count) || 0,
      approvedCount: Number(periodTotals?.approved_count) || 0,
      // Payment-anchored, by payment date.
      cashReceipts: Number(periodTotals?.cash_receipts) || 0,
      refundsIssued: Number(periodTotals?.refunds_issued) || 0,
      // Payments Received: kept money — receipts less refunds.
      paymentsReceived: paymentsReceivedNet(periodTotals?.cash_receipts, periodTotals?.refunds_issued),
      reversalsRecorded: Number(periodTotals?.reversals_recorded) || 0,
      receiptCount: Number(periodTotals?.receipt_count) || 0,
      // Kept from bookings that did not happen.
      forfeitedDeposits: Number(periodTotals?.forfeited_deposits) || 0,
      forfeitedCount: Number(periodTotals?.forfeited_count) || 0,
      // EARNED = contracted work + deposits kept on cancelled or rejected
      // bookings. A non-refundable deposit is income the business keeps, so it
      // counts as revenue, and because it was received it counts on the paid
      // side too — which keeps paid + collectible = revenue exact. Only the
      // RETAINED amount is added, never the cancelled booking's contract value.
      // (sql/report_period_income_terms.sql moves these two sums into
      // f_report_period as earned_revenue and collections_applied.)
      earnedRevenue: (Number(periodTotals?.gross_contracted) || 0) + (Number(periodTotals?.forfeited_deposits) || 0),
      paidOnEvents: (Number(periodTotals?.paid_contracted) || 0) + (Number(periodTotals?.forfeited_deposits) || 0),
      // Same population as the cards they open: contracted work plus the
      // kept deposits, each kept deposit listed at the amount retained.
      _revenueBreakdown: [
        ...moneyInEventRange.filter(m => m.counts_toward_revenue).map(breakdownRow),
        ...moneyInEventRange.filter(m => m.is_closed && Number(m.net_paid) > 0).map(keptDepositRow),
      ],
      _collectedBreakdown: [
        ...moneyInEventRange.filter(m => m.counts_toward_revenue && Number(m.net_paid) > 0).map(breakdownRow),
        ...moneyInEventRange.filter(m => m.is_closed && Number(m.net_paid) > 0).map(keptDepositRow),
      ],
      _outstandingBreakdown: moneyInEventRange.filter(m => m.counts_toward_revenue && Number(m.outstanding) > 0).map(breakdownRow),
      _approvedBreakdown: moneyInEventRange.filter(m => m.booking_status === 'Approved').map(breakdownRow),
    };

    // --- PAYMENT METHOD & REFUNDS ---
    // Methods count RECEIPTS only — counted, positive entries. A refund is
    // money going the other way and a reversal is a correction; neither is a
    // way of paying.
    const methodMap = {};
    countedInRange.filter(p => (p.amount_paid || 0) > 0).forEach(p => {
      const method = p.pay_method || 'Unspecified';
      if (!methodMap[method]) methodMap[method] = { method, count: 0, total: 0 };
      methodMap[method].count += 1;
      methodMap[method].total += p.amount_paid;
    });
    const paymentMethodData = Object.values(methodMap).sort((a, b) => b.total - a.total);

    // Refunds are entry_type Refund. Reversals are listed separately, never
    // here: the page used to file every negative row under refunds, so a
    // correction read as money returned to a customer.
    const describeEntry = (p) => ({
      ...p,
      bookingRef: p.booking_number || (bookingsById[p.booking_id] ? getBookingRef(bookingsById[p.booking_id]) : null),
      bookingType: p.booking_type || bookingsById[p.booking_id]?.booking_type || 'Package',
    });
    const refunds = entriesInRange.filter(p => isRefundEntry(p) && movesBooks(p)).map(describeEntry);
    const reversals = entriesInRange.filter(isReversalEntry).map(describeEntry);

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
    const packageBookings = acceptedBookingsInRange.filter(b => b.booking_type === 'Package' && b.package_id);
    const shortOrderBookings = acceptedBookingsInRange.filter(b => b.booking_type === 'Short Order');

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

    // --- VEHICLES ---
    // --- CUSTOMER INSIGHTS ---
    const customerMap = {};
    acceptedBookingsInRange.forEach(b => {
      if (!b.customer_id) return;
      const name = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
      if (!customerMap[b.customer_id]) {
        customerMap[b.customer_id] = { customerId: b.customer_id, name, bookings: 0, spend: 0, firstBookingDate: b.book_datetime };
      }
      const entry = customerMap[b.customer_id];
      entry.bookings += 1;
      entry.spend += netPaidByBooking[b.booking_id] || 0;
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

    // The Financial tab's three-line trend. Built by a pure helper, given the
    // FULL booking and payment lists rather than the range-scoped copies —
    // this series ignores the period filter by design, and the chart says so.
    // Contracted work only, matching Estimated Gross Revenue on the cards: a
    // Pending request is not revenue. Paid uses counted entries for the same
    // reason the cards do.
    const monthlyFinancialTrend = buildMonthlyFinancialTrend(
      bookings, countedEntries, new Date(), { excludeStatuses: [...UNACCEPTED_STATUSES, 'Approved'], keptDepositStatuses: CANCELLED_STATUSES }
    );

    return {
      financialSummary, monthlyFinancialTrend, paymentMethodData, refunds, reversals,
      productLineMix, packageMix, menuItemMix, categoryDemandData,
      packageRevenue, shortOrderRevenue, combinedRevenue,
      menuItemRevenue, deliveryFeeTotal, unattributedFoodRevenue, traysSold, topSellingItem,
      hasEstimatedMenuRevenue, totalPackageBookings,
      repeatCustomers, oneTimeCustomers, totalCustomers: customerList.length,
      bookingSummaryData,
    };
  }, [rawData, rangeStart, rangeEnd, periodTotals]);

  const handleCardClick = (type) => {
    if (!derived) return;
    const breakdowns = {
      revenue: { data: derived.financialSummary._revenueBreakdown, title: `Estimated Gross Revenue — ${periodTitle(datePreset, rangeStart, rangeEnd)}` },
      collected: { data: derived.financialSummary._collectedBreakdown, title: `Paid on These Events — ${periodTitle(datePreset, rangeStart, rangeEnd)}` },
      outstanding: { data: derived.financialSummary._outstandingBreakdown, title: `Collectible — ${periodTitle(datePreset, rangeStart, rangeEnd)}` },
      approved: { data: derived.financialSummary._approvedBreakdown, title: `Approved — ${periodTitle(datePreset, rangeStart, rangeEnd)}` },
    };
    const entry = breakdowns[type];
    if (!entry) return;
    // The rows are already this page's period. The modal re-filters by its own
    // date control, so it opens on that same period rather than narrowing an
    // All Time card to this month.
    setDetailModal({ open: true, type, data: entry.data, title: entry.title, datePreset, customStart, customEnd });
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
            Revenue, cash and menu performance.
          </p>
        </div>
      </div>

      {/* Filter bar, then the period title, then the tabs. One Period for all
          four tabs: switching tabs never changes which period is shown. */}
      <FilterBar canClear={datePreset !== DEFAULT_DATE_PRESET} onClear={handleClearFilter}>
        <FilterField label="Period" active={datePreset !== DEFAULT_DATE_PRESET}>
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
            defaultPreset={DEFAULT_DATE_PRESET}
            showSummary={false}
            showClear={false}
          />
        </FilterField>
      </FilterBar>
      <PeriodTitle>{periodTitle(datePreset, rangeStart, rangeEnd)}</PeriodTitle>

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

      {isLoading || !derived || (!periodTotals && !totalsError) ? (
        <div className="w-full py-20 flex justify-center items-center text-slate-500 font-medium">
          Loading metrics and database summaries...
        </div>
      ) : (
        <div className="animate-in fade-in duration-200 space-y-[18px]">
          {activeTab === 'Overview' && <OverviewTab derived={derived} period={period} span={span} canClearFilters={datePreset !== DEFAULT_DATE_PRESET} onClearFilters={handleClearFilter} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Financial' && <FinancialTab derived={derived} span={span} canClearFilters={datePreset !== DEFAULT_DATE_PRESET} onClearFilters={handleClearFilter} onCardClick={handleCardClick} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Menu & Packages' && <MenuPerformanceTab derived={derived} canClearFilters={datePreset !== DEFAULT_DATE_PRESET} onClearFilters={handleClearFilter} onOpenDetail={openSimpleModal} />}
          {activeTab === 'Booking Summary' && <BookingSummaryTab derived={derived} canClearFilters={datePreset !== DEFAULT_DATE_PRESET} onClearFilters={handleClearFilter} onOpenDetail={openSimpleModal} />}
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
