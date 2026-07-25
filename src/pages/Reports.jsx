import { useState, useEffect } from 'react';
import { supabase } from '../supabase';

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

  const [monthlyRevenueData, setMonthlyRevenueData] = useState([]);
  const [menuPerformanceData, setMenuPerformanceData] = useState([]);
  const [equipmentUtilizationData, setEquipmentUtilizationData] = useState([]);
  const [bookingSummaryData, setBookingSummaryData] = useState([]);

  // --- FETCH ALL REPORT DATA ---
  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      // 1. Get current month label
      const now = new Date();
      const currentMonthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

      // ========== FINANCIAL SUMMARY (FIXED) ==========
      // Get all payments with booking_id
      const { data: payments, error: paymentsError } = await supabase
        .from('payment')
        .select('amount_paid, booking_id');
      if (paymentsError) throw paymentsError;

      // Group payments by booking
      const paymentMap = {};
      payments.forEach(p => {
        if (!paymentMap[p.booking_id]) paymentMap[p.booking_id] = 0;
        paymentMap[p.booking_id] += p.amount_paid;
      });

      // Get all bookings with total_amount
      const { data: bookings, error: bookingsError } = await supabase
        .from('booking')
        .select('booking_id, total_amount, booking_status')
        .eq('booking_type', 'Package');
      if (bookingsError) throw bookingsError;

      let totalCollected = 0;
      let totalOutstanding = 0;
      let totalContractValue = 0;

      bookings.forEach(b => {
        const paid = paymentMap[b.booking_id] || 0;
        const total = b.total_amount || 0;
        totalContractValue += total;
        totalCollected += paid;
        const outstanding = Math.max(0, total - paid);
        totalOutstanding += outstanding;
      });

      setFinancialSummary({
        totalRevenue: totalContractValue,
        collected: totalCollected,
        outstanding: totalOutstanding,
        currentMonthLabel,
      });

      // ========== MONTHLY REVENUE ==========
      const monthMap = {};
      payments.forEach(p => {
        if (!p.pay_datetime) return;
        const date = new Date(p.pay_datetime);
        const monthKey = date.toLocaleString('default', { month: 'short' });
        if (!monthMap[monthKey]) monthMap[monthKey] = 0;
        monthMap[monthKey] += p.amount_paid;
      });

      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyData = monthOrder
        .filter(m => monthMap[m])
        .map((month, index) => ({
          id: index,
          month,
          revenue: monthMap[month],
        }));

      setMonthlyRevenueData(monthlyData);

      // ========== MENU PERFORMANCE ==========
      const { data: packageBookings, error: pkgError } = await supabase
        .from('booking')
        .select(`
          package_id,
          total_amount,
          package:package_id (pkg_name)
        `)
        .eq('booking_type', 'Package')
        .not('package_id', 'is', null);

      if (pkgError) throw pkgError;

      const packageMap = {};
      packageBookings.forEach(b => {
        const pkgId = b.package_id;
        if (!packageMap[pkgId]) {
          packageMap[pkgId] = {
            name: b.package?.pkg_name || 'Unknown',
            orders: 0,
            revenue: 0,
          };
        }
        packageMap[pkgId].orders += 1;
        packageMap[pkgId].revenue += b.total_amount || 0;
      });

      const maxOrders = Math.max(...Object.values(packageMap).map(p => p.orders), 1);
      const menuPerf = Object.entries(packageMap).map(([id, data], index) => {
        const performance = Math.round((data.orders / maxOrders) * 100);
        return {
          id: `PKG-${index + 1}`,
          name: data.name,
          performance: performance,
          totalOrders: data.orders,
          revenueGenerated: data.revenue,
          status: performance < 10 ? 'warning' : 'good',
        };
      });
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
        const total = eq.quantity_available + (deployedMap[eq.equipment_id] || 0);
        const deployed = deployedMap[eq.equipment_id] || 0;
        const available = eq.quantity_available;
        return {
          id: eq.equipment_id,
          name: eq.eqm_name,
          total: total,
          available: available,
          deployed: deployed,
          damaged: 0, // no separate damaged count
        };
      });
      setEquipmentUtilizationData(utilData);

      // ========== BOOKING SUMMARY ==========
      const { data: allBookings, error: allError } = await supabase
        .from('booking')
        .select('booking_id, event_datetime, total_amount, booking_status, package_id, package:package_id (pkg_name)')
        .eq('booking_type', 'Package')
        .not('event_datetime', 'is', null);

      if (allError) throw allError;

      const monthGroup = {};
      allBookings.forEach(b => {
        const date = new Date(b.event_datetime);
        const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (!monthGroup[monthKey]) {
          monthGroup[monthKey] = {
            bookings: 0,
            revenue: 0,
            collected: 0,
            outstanding: 0,
            topPackage: '',
            packageCounts: {},
          };
        }
        const group = monthGroup[monthKey];
        group.bookings += 1;
        group.revenue += b.total_amount || 0;
        const pkgName = b.package?.pkg_name || 'None';
        if (!group.packageCounts[pkgName]) group.packageCounts[pkgName] = 0;
        group.packageCounts[pkgName] += 1;
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
          month: month,
          bookings: data.bookings,
          revenue: data.revenue,
          collected: 0, // would need payment grouping
          outstanding: 0,
          topPackage: topPackage,
        };
      });

      setBookingSummaryData(summary);

    } catch (error) {
      console.error('Error fetching report data:', error);
      alert('Failed to load report data. Please check console.');
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

  // --- Render ---
  return (
    <div className="space-y-6 relative pb-12 pr-2">
      {/* PAGE TITLE HEADER */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">Financial performance and operational summaries</p>
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
                <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6">
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Total Revenue</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.totalRevenue)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">{financialSummary.currentMonthLabel}</p>
                </div>
                <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6">
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Collected</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.collected)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">All payments received</p>
                </div>
                <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-xl p-6">
                  <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Outstanding</p>
                  <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.outstanding)}</h3>
                  <p className="text-xs text-slate-500 font-medium mt-2">Remaining balances</p>
                </div>
              </div>

              {/* BAR CHART */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-[#f8fafa] border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-bold text-slate-900 mb-6">Monthly Revenue</h3>
                  <div className="relative h-48 flex items-end gap-2 sm:gap-6 pt-4">
                    <div className="absolute inset-0 flex flex-col justify-between text-[10px] text-slate-400 font-medium pb-6">
                      <div className="flex items-center gap-2 border-b border-dashed border-slate-200 w-full h-0"><span className="w-8 text-right -mt-2">₱40k</span></div>
                      <div className="flex items-center gap-2 border-b border-dashed border-slate-200 w-full h-0"><span className="w-8 text-right -mt-2">₱30k</span></div>
                      <div className="flex items-center gap-2 border-b border-dashed border-slate-200 w-full h-0"><span className="w-8 text-right -mt-2">₱20k</span></div>
                      <div className="flex items-center gap-2 border-b border-dashed border-slate-200 w-full h-0"><span className="w-8 text-right -mt-2">₱10k</span></div>
                      <div className="flex items-center gap-2 border-b border-slate-300 w-full h-0"><span className="w-8 text-right -mt-2">0</span></div>
                    </div>
                    <div className="relative z-10 flex justify-between items-end w-full h-full pb-6 pl-12 pr-4">
                      {monthlyRevenueData.map((data, index) => {
                        const maxRevenue = Math.max(...monthlyRevenueData.map(d => d.revenue), 1);
                        const heightPercentage = (data.revenue / maxRevenue) * 100;
                        const isLast = index === monthlyRevenueData.length - 1;
                        return (
                          <div key={data.id} className="flex flex-col items-center gap-2 w-1/6 group cursor-pointer">
                            <div className={`w-full rounded-sm transition-all duration-500 relative ${isLast ? 'bg-[#008A45]' : 'bg-[#CBDEDD]'}`} style={{ height: `${heightPercentage}%` }}>
                              <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] py-1 px-2 rounded pointer-events-none whitespace-nowrap z-30 transition-opacity">
                                {formatCurrency(data.revenue)}
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-slate-600 absolute bottom-0">{data.month}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* MENU PERFORMANCE MINI */}
                <div className="bg-[#f8fafa] border border-slate-200 rounded-xl p-6">
                  <h3 className="text-base font-bold text-slate-900 mb-6">Menu Performance</h3>
                  <div className="space-y-5">
                    {menuPerformanceData.slice(0, 4).map((pkg) => (
                      <div key={pkg.id}>
                        <div className="flex justify-between text-xs font-bold mb-1">
                          <span className="text-slate-800">{pkg.name}</span>
                          <span className="text-slate-600">{pkg.performance}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${pkg.status === 'warning' ? 'bg-red-500' : 'bg-[#008A45]'}`} style={{ width: `${pkg.performance}%` }}></div>
                        </div>
                        {pkg.status === 'warning' && (
                          <p className="text-[11px] text-red-500 font-semibold mt-1">*Below 10% threshold</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* BOOKING SUMMARY MINI */}
              <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200"><h3 className="text-base font-bold text-slate-900">Monthly Booking Summary</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                        <th className="p-4">Month</th>
                        <th className="p-4">Bookings</th>
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
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* MENU PERFORMANCE TAB */}
          {/* ========================================================= */}
          {activeTab === 'Menu Performance' && (
            <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">Comprehensive Package Performance Analytics</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                      <th className="p-4">Package Name</th>
                      <th className="p-4">Popularity Metric</th>
                      <th className="p-4">Total Orders Filled</th>
                      <th className="p-4">Gross Revenue Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {menuPerformanceData.map((pkg) => (
                      <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-bold text-slate-900">{pkg.name}</td>
                        <td className="p-4 w-1/3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-600 w-8">{pkg.performance}%</span>
                            <div className="w-full bg-slate-200 rounded-full h-2 max-w-xs">
                              <div className={`h-2 rounded-full ${pkg.status === 'warning' ? 'bg-red-500' : 'bg-[#008A45]'}`} style={{ width: `${pkg.performance}%` }}></div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 font-medium text-slate-700">{pkg.totalOrders} Orders</td>
                        <td className="p-4 font-bold text-emerald-700">{formatCurrency(pkg.revenueGenerated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* BOOKING SUMMARY TAB */}
          {/* ========================================================= */}
          {activeTab === 'Booking Summary' && (
            <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">Historical Booking Performance Table</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                      <th className="p-4">Accounting Month</th>
                      <th className="p-4">Total Successful Bookings</th>
                      <th className="p-4">Gross Contract Value</th>
                      <th className="p-4">Top Revenue Package</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {bookingSummaryData.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-bold text-slate-900">{row.month}</td>
                        <td className="p-4 text-slate-700 font-medium">{row.bookings} Confirmed Events</td>
                        <td className="p-4 font-bold text-slate-900">{formatCurrency(row.revenue)}</td>
                        <td className="p-4"><span className="px-2.5 py-1 bg-slate-200 text-slate-800 font-semibold text-xs rounded-full">{row.topPackage}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}