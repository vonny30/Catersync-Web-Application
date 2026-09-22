// src/components/CollectibleBreakdown.jsx
//
// Where the Collectible figure comes from: every Confirmed or Completed booking
// with an event in the period and money still owed, one row each. The Balance
// Due column adds up to the card. Shared by the Payments and Customers pages,
// which compute it with the same rule (utils/reportMetrics collectibleInPeriod).
import { createPortal } from 'react-dom';
import { X, ExternalLink } from 'lucide-react';
import { EmptyResult } from './FilterBar';
import { formatDate } from '../pages/Reports/helpers';

const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
const bookingRef = (b) => b?.booking_number
  || (b?.booking_id ? `${b.booking_type === 'Short Order' ? 'SO' : 'BKG'}-${b.booking_id.slice(0, 8)}` : '—');

/**
 * @param bookings   the owing rows (collectibleInPeriod().owing)
 * @param caption    the sentence under the title, naming the period
 */
export default function CollectibleBreakdown({ bookings, caption, total, onClose, onOpenBooking }) {
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">Collectible</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto bg-[#fbfcfd]">
          <p className="text-[13px] text-slate-600 mb-3">{caption}</p>
          {bookings.length === 0 ? (
            <EmptyResult className="py-6" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-[#fbfcfd] border-b border-slate-100 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">
                    <th className="px-3 py-2.5">Booking</th>
                    <th className="px-3 py-2.5">Event Date</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Transaction Amount</th>
                    <th className="px-3 py-2.5 text-right">Collected</th>
                    <th className="px-3 py-2.5 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {bookings.map(b => (
                    <tr key={b.booking_id} onClick={() => onOpenBooking(b)} className="hover:bg-[#fbfcfd] cursor-pointer" title="Open the booking">
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-[#007038] inline-flex items-center gap-1">{bookingRef(b)} <ExternalLink size={11} /></span>
                        <span className="block text-[12px] text-slate-500">{b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown customer'}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{b.event_datetime ? formatDate(b.event_datetime) : '—'}</td>
                      <td className="px-3 py-2.5">{b.booking_status}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{peso(b.total_amount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{peso(b.net_paid)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-amber-700">{peso(b.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-[#fbfcfd] font-bold text-slate-900">
                    <td className="px-3 py-2.5" colSpan={5}>{bookings.length} booking{bookings.length === 1 ? '' : 's'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{peso(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
          <button type="button" onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
