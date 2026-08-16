// src/pages/Reports/DetailModal.jsx
import { createPortal } from 'react-dom';
import { formatCurrency, formatDate } from './helpers';

export default function DetailModal({ detailModal, onClose }) {
  if (!detailModal.open) return null;

  return createPortal(
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
            onClick={onClose}
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
