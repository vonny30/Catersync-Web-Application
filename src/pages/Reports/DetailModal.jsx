// src/pages/Reports/DetailModal.jsx
import { useState } from 'react';
import Select from '../../components/Select';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Search } from 'lucide-react';
import { formatCurrency, formatDate, getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET } from './helpers';
import DateRangeFilter from './DateRangeFilter';

export default function DetailModal({ detailModal, onClose }) {
  const navigate = useNavigate();

  // --- Search/filter — same pattern as Payments.jsx's summary modals and
  // Dashboard.jsx's stats modal, applied here so every card-click record
  // list filters the same way.
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All'); // 'All' | 'Package' | 'Short Order'
  const [statusFilter, setStatusFilter] = useState('All'); // revenue view only
  const [datePreset, setDatePreset] = useState(DEFAULT_DATE_PRESET);
  const [dateCustomStart, setDateCustomStart] = useState('');
  const [dateCustomEnd, setDateCustomEnd] = useState('');

  const resetFilters = () => {
    setSearchTerm('');
    setTypeFilter('All');
    setStatusFilter('All');
    setDatePreset(DEFAULT_DATE_PRESET);
    setDateCustomStart('');
    setDateCustomEnd('');
  };

  // Reset filters the moment the modal transitions closed -> open, without a
  // useEffect (adjusting state during render, per React's own guidance for
  // this exact "reset on prop change" case).
  const [prevOpen, setPrevOpen] = useState(detailModal.open);
  if (detailModal.open !== prevOpen) {
    setPrevOpen(detailModal.open);
    if (detailModal.open) resetFilters();
  }

  const { start: dateRangeStart, end: dateRangeEnd } = getRangeBounds(datePreset, dateCustomStart, dateCustomEnd);

  const filteredData = detailModal.data.filter((item) => {
    if (typeFilter !== 'All') {
      const itemType = item.type === 'Short Order' ? 'Short Order' : 'Package';
      if (itemType !== typeFilter) return false;
    }
    if (detailModal.type === 'revenue' && statusFilter !== 'All' && item.status !== statusFilter) return false;
    if (datePreset !== DEFAULT_DATE_PRESET && !isWithinRange(item.eventDate, dateRangeStart, dateRangeEnd)) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const customer = (item.customer || '').toLowerCase();
      const ref = (item.bookingRef || '').toLowerCase();
      if (!customer.includes(term) && !ref.includes(term)) return false;
    }
    return true;
  });
  const activeFilterCount = (searchTerm.trim() ? 1 : 0) + (typeFilter !== 'All' ? 1 : 0) + (detailModal.type === 'revenue' && statusFilter !== 'All' ? 1 : 0) + (datePreset !== DEFAULT_DATE_PRESET ? 1 : 0);

  if (!detailModal.open) return null;

  const goToBookingDetails = (id, type) => {
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{detailModal.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Excludes Rejected and Cancelled bookings • {filteredData.length} of {detailModal.data.length} records shown
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {detailModal.data.length > 0 && (
          <div className={`px-6 py-3 border-b space-y-2 shrink-0 ${activeFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-3">
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                  {activeFilterCount} active
                </span>
              )}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Search by customer or booking ref..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${searchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                />
              </div>
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${typeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
              >
                <option value="All">All types</option>
                <option value="Package">Package</option>
                <option value="Short Order">Short Order</option>
              </Select>
              {detailModal.type === 'revenue' && (
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={`border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${statusFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
                >
                  <option value="All">All statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Completed">Completed</option>
                </Select>
              )}
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
            <div className="flex flex-col items-start gap-1">
              <p className="text-xs font-semibold text-slate-600">Filter by event date:</p>
              <DateRangeFilter
                preset={datePreset}
                customStart={dateCustomStart}
                customEnd={dateCustomEnd}
                rangeStart={dateRangeStart}
                rangeEnd={dateRangeEnd}
                onPresetChange={setDatePreset}
                onCustomStartChange={setDateCustomStart}
                onCustomEndChange={setDateCustomEnd}
                onClear={() => { setDatePreset(DEFAULT_DATE_PRESET); setDateCustomStart(''); setDateCustomEnd(''); }}
              />
            </div>
          </div>
        )}

        <div className="p-6 overflow-y-auto flex-1">
          {detailModal.data.length === 0 ? (
            <div className="text-center py-10 text-slate-500">No records found for this category.</div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-10 text-slate-500">No records match your search/filter.</div>
          ) : (
            <div className="space-y-4">
              {detailModal.type === 'revenue' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Reference</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Customer</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Event Date</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Contract Value</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredData.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-5 py-[15px]">
                          <button
                            onClick={() => goToBookingDetails(item.id, item.type)}
                            className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {item.bookingRef} <ExternalLink size={10} />
                          </button>
                        </td>
                        <td className="px-5 py-[15px] font-medium text-slate-900">{item.customer}</td>
                        <td className="px-5 py-[15px]">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                          </span>
                        </td>
                        <td className="px-5 py-[15px] text-slate-600">{formatDate(item.eventDate)}</td>
                        <td className="px-5 py-[15px] text-right font-bold text-slate-900">{formatCurrency(item.total)}</td>
                        <td className="px-5 py-[15px] text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-700' : item.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : item.status === 'Approved' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan="4" className="p-3 text-right font-bold text-slate-700">Total:</td>
                      <td className="px-5 py-[15px] text-right font-bold text-emerald-700">{formatCurrency(filteredData.reduce((sum, item) => sum + item.total, 0))}</td>
                      <td className="px-5 py-[15px]"></td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {detailModal.type === 'collected' && (
                <div className="space-y-6">
                  {filteredData.map((item) => (
                    <div key={item.id} className="border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-bold text-slate-900 flex items-center gap-2">
                            <button
                              onClick={() => goToBookingDetails(item.id, item.type)}
                              className="font-mono text-xs bg-slate-100 hover:bg-emerald-50 hover:text-[#008A45] px-2 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer transition-colors"
                              title="View full booking details"
                            >
                              {item.bookingRef} <ExternalLink size={10} />
                            </button>
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
                      Total Collected: <span className="text-emerald-600">{formatCurrency(filteredData.reduce((sum, item) => sum + item.paid, 0))}</span>
                    </p>
                  </div>
                </div>
              )}

              {detailModal.type === 'outstanding' && (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Reference</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Customer</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Event Date</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Total</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Paid</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredData.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-5 py-[15px]">
                          <button
                            onClick={() => goToBookingDetails(item.id, item.type)}
                            className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {item.bookingRef} <ExternalLink size={10} />
                          </button>
                        </td>
                        <td className="px-5 py-[15px] font-medium text-slate-900">{item.customer}</td>
                        <td className="px-5 py-[15px]">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                          </span>
                        </td>
                        <td className="px-5 py-[15px] text-slate-600">{formatDate(item.eventDate)}</td>
                        <td className="px-5 py-[15px] text-right text-slate-600">{formatCurrency(item.total)}</td>
                        <td className="px-5 py-[15px] text-right text-emerald-600">{formatCurrency(item.paid)}</td>
                        <td className="px-5 py-[15px] text-right font-bold text-red-600">{formatCurrency(item.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan="6" className="p-3 text-right font-bold text-slate-700">Total Outstanding:</td>
                      <td className="px-5 py-[15px] text-right font-bold text-red-600">{formatCurrency(filteredData.reduce((sum, item) => sum + item.outstanding, 0))}</td>
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
            onClick={onClose}
            className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
