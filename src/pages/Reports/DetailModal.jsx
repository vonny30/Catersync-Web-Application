// src/pages/Reports/DetailModal.jsx
import { useState } from 'react';
import ModalTotal from '../../components/ModalTotal';
import Select from '../../components/Select';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatCurrency, formatDate } from './helpers';
import { PopupFilters, popupSelectClass, EmptyResult } from '../../components/FilterBar';

const HEAD_CLASS = 'px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap';

export default function DetailModal({ detailModal, onClose }) {
  const navigate = useNavigate();

  // --- Search/filter — same pattern as Payments.jsx's summary modals and
  // Dashboard.jsx's stats modal, applied here so every card-click record
  // list filters the same way.
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All'); // 'All' | 'Package' | 'Short Order'
  const [statusFilter, setStatusFilter] = useState('All'); // revenue and outstanding views

  const resetFilters = () => {
    setSearchTerm('');
    setTypeFilter('All');
    setStatusFilter('All');
  };

  // Reset filters the moment the modal transitions closed -> open, without a
  // useEffect (adjusting state during render, per React's own guidance for
  // this exact "reset on prop change" case).
  const [prevOpen, setPrevOpen] = useState(detailModal.open);
  if (detailModal.open !== prevOpen) {
    setPrevOpen(detailModal.open);
    if (detailModal.open) resetFilters();
  }

  // NO DATE FILTER HERE. The rows arrive already scoped to the page's Period —
  // they are the rows behind the card that was clicked — so a second period
  // inside the pop-up could only move them out of step with that card.
  // Outstanding needs it too: its card names what is not collectable until
  // approved, and the list has to be able to show exactly those rows.
  const hasStatusFilter = detailModal.type === 'revenue' || detailModal.type === 'outstanding';

  const filteredData = detailModal.data.filter((item) => {
    if (typeFilter !== 'All') {
      const itemType = item.type === 'Short Order' ? 'Short Order' : 'Package';
      if (itemType !== typeFilter) return false;
    }
    if (hasStatusFilter && statusFilter !== 'All' && item.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const customer = (item.customer || '').toLowerCase();
      const ref = (item.bookingRef || '').toLowerCase();
      if (!customer.includes(term) && !ref.includes(term)) return false;
    }
    return true;
  });
  const activeFilterCount = (searchTerm.trim() ? 1 : 0) + (typeFilter !== 'All' ? 1 : 0) + (hasStatusFilter && statusFilter !== 'All' ? 1 : 0);

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
              {detailModal.type === 'forfeited'
                ? 'Cancelled and rejected bookings that kept money • '
                : detailModal.type === 'revenue' || detailModal.type === 'collected'
                  ? 'Confirmed and completed, plus kept deposits • '
                  : 'Confirmed and completed • '}
              {filteredData.length} of {detailModal.data.length} booking{detailModal.data.length === 1 ? '' : 's'} shown
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
          <PopupFilters
            search={searchTerm}
            onSearch={setSearchTerm}
            searchPlaceholder="Search by customer or booking ref..."
            canClear={activeFilterCount > 0}
            onClear={resetFilters}
          >
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={popupSelectClass(typeFilter !== 'All')}>
              <option value="All">All types</option>
              <option value="Package">Package</option>
              <option value="Short Order">Short Order</option>
            </Select>
            {hasStatusFilter && (
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={popupSelectClass(statusFilter !== 'All')}>
                <option value="All">All statuses</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Completed">Completed</option>
                {/* Revenue also lists deposits kept on cancelled or rejected bookings. */}
                {detailModal.type === 'revenue' && <option value="Cancelled">Cancelled (kept deposit)</option>}
                {detailModal.type === 'revenue' && <option value="Rejected">Rejected (kept deposit)</option>}
              </Select>
            )}
          </PopupFilters>
        )}

        <div className="p-6 overflow-y-auto flex-1 bg-[#fbfcfd]">
          {detailModal.data.length === 0 || filteredData.length === 0 ? (
            <EmptyResult canClear={activeFilterCount > 0} onClear={resetFilters} className="py-10" />
          ) : (
            <div className="space-y-4">
              {detailModal.type === 'revenue' && (
                <table className="w-full text-left border-separate border-spacing-0 bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Reference</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Customer</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Event Date</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Estimated Gross Revenue</th>
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
                        <td className="px-5 py-[15px] whitespace-nowrap">
                          <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                          </span>
                        </td>
                        <td className="px-5 py-[15px] text-slate-600">{formatDate(item.eventDate)}</td>
                        <td className="px-5 py-[15px] text-right font-bold text-slate-900">{formatCurrency(item.total)}</td>
                        <td className="px-5 py-[15px] text-right">
                          <span className={`inline-block whitespace-nowrap px-2 py-1 rounded-full text-xs font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-700' : item.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : item.status === 'Approved' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
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
                <table className="w-full text-left border-separate border-spacing-0 bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Reference</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Customer</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Event Date</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Total</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Paid</th>
                      <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Balance</th>
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
                        <td className="px-5 py-[15px] whitespace-nowrap">
                          <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                          </span>
                        </td>
                        <td className="px-5 py-[15px] text-slate-600">{formatDate(item.eventDate)}</td>
                        <td className="px-5 py-[15px] text-right text-slate-600">{formatCurrency(item.total)}</td>
                        <td className="px-5 py-[15px] text-right text-emerald-600">{formatCurrency(item.paid)}</td>
                        <td className="px-5 py-[15px] text-right font-bold text-red-600">{formatCurrency(item.outstanding)}</td>
                        <td className="px-5 py-[15px] text-right">
                          <span className={`inline-block whitespace-nowrap px-2 py-1 rounded-full text-xs font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-700' : item.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : item.status === 'Approved' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}


              {/* Forfeited deposits: money the business kept when a booking
                  fell through. It is realised income, so it is audited exactly
                  like a receipt — every row, by booking, with what was kept. */}
              {detailModal.type === 'forfeited' && (
                <table className="w-full text-left border-separate border-spacing-0 bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className={HEAD_CLASS}>Reference</th>
                      <th className={HEAD_CLASS}>Customer</th>
                      <th className={HEAD_CLASS}>Type</th>
                      <th className={HEAD_CLASS}>Event Date</th>
                      <th className={`${HEAD_CLASS} text-right`}>Transaction Amount</th>
                      <th className={`${HEAD_CLASS} text-right`}>Retained</th>
                      <th className={`${HEAD_CLASS} text-right`}>Status</th>
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
                        <td className="px-5 py-[15px] whitespace-nowrap">
                          <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'Short Order' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                            {item.type === 'Short Order' ? 'Short Order' : 'Package'}
                          </span>
                        </td>
                        <td className="px-5 py-[15px] text-slate-600">{formatDate(item.eventDate)}</td>
                        <td className="px-5 py-[15px] text-right text-slate-600">{formatCurrency(item.total)}</td>
                        <td className="px-5 py-[15px] text-right font-bold text-slate-900">{formatCurrency(item.paid)}</td>
                        <td className="px-5 py-[15px] text-right">
                          <span className="inline-block whitespace-nowrap px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-4">
                <p className="text-sm text-blue-800">
                  {detailModal.type === 'forfeited' ? (
                    <><strong>Note:</strong> These bookings were cancelled or rejected. The amount retained is money already collected that was not refunded — realised income, kept out of Estimated Gross Revenue on purpose.</>
                  ) : (
                    detailModal.type === 'revenue' || detailModal.type === 'collected'
                      ? <><strong>Note:</strong> Confirmed and completed bookings, plus deposits kept on cancelled or rejected bookings, listed at the amount kept. Pending and approved bookings are not included.</>
                      : <><strong>Note:</strong> Confirmed and completed bookings only. Pending and approved bookings are not included.</>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
          {detailModal.type === 'revenue' && (
            <div className="min-w-0">
              <ModalTotal
                label="Total"
                value={formatCurrency(filteredData.reduce((sum, item) => sum + item.total, 0))}
                hint={`${filteredData.length} booking${filteredData.length === 1 ? '' : 's'}`}
              />
            </div>
          )}
          {detailModal.type === 'outstanding' && (
            <div className="min-w-0">
              <ModalTotal
                label="Total outstanding"
                value={formatCurrency(filteredData.reduce((sum, item) => sum + item.outstanding, 0))}
                tone="negative"
                hint={`${filteredData.length} booking${filteredData.length === 1 ? '' : 's'}`}
              />
            </div>
          )}
          {detailModal.type === 'forfeited' && (
            <ModalTotal
              label="Total retained"
              value={formatCurrency(filteredData.reduce((sum, item) => sum + item.paid, 0))}
              hint={`${filteredData.length} cancelled booking${filteredData.length === 1 ? '' : 's'}`}
            />
          )}
          {!['revenue', 'outstanding', 'forfeited'].includes(detailModal.type) && <span />}
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
