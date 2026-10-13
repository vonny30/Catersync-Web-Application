// src/components/InstallmentPlanCard.jsx
//
// The installment plan on the Booking Details and Short Order Details pages,
// in the payments area.
//
//   Standard booking, suki customer, Approved or Confirmed
//       -> a "Suki customer" note and "Start installment plan".
//   Standard booking otherwise -> nothing.
//   Installment booking
//       -> progress, what is due now and next, the schedule with each row's
//          status, and Edit schedule / End plan / History.
//
// Every change goes through the database functions (f_save_installment_plan,
// f_end_installment_plan), which check everything and write the history; this
// card only shows their result. Their error messages are written for the
// manager and are shown as they are. Spec: docs/feature-suki-installments.md §5.3.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { CalendarClock, ChevronDown, ChevronRight, Star, X } from 'lucide-react';
import { supabase } from '../supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { SectionCard, SectionHeader } from './DetailPrimitives';
import InstallmentScheduleEditor, { DueAfterEventNote } from './InstallmentScheduleEditor';
import {
  isInstallmentPlan, buildEvenSchedule, validateSchedule, toRpcRows, todayManila,
  dueAfterEventDate, INSTALLMENT_STATUS_PILL, longYmd, shortYmd,
} from '../utils/installments';

const money = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TEXTAREA = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none';
const ACTION = 'text-[13px] font-bold text-[#007038] hover:text-[#00532a] disabled:opacity-50 disabled:cursor-not-allowed';

/** Before -> after, row by row: what was added, removed, or changed. */
function planDiff(before, after) {
  const b = Object.fromEntries((before || []).map(r => [r.no, r]));
  const a = Object.fromEntries((after || []).map(r => [r.no, r]));
  const nos = [...new Set([...Object.keys(b), ...Object.keys(a)].map(Number))].sort((x, y) => x - y);
  const lines = [];
  for (const no of nos) {
    const x = b[no]; const y = a[no];
    if (x && !y) lines.push(`#${no} removed (${money(x.amount)} due ${shortYmd(x.due_date)})`);
    else if (!x && y) lines.push(`#${no} added: ${money(y.amount)} due ${shortYmd(y.due_date)}`);
    else {
      const parts = [];
      if (x.due_date !== y.due_date) parts.push(`${shortYmd(x.due_date)} → ${shortYmd(y.due_date)}`);
      if (Number(x.amount) !== Number(y.amount)) parts.push(`${money(x.amount)} → ${money(y.amount)}`);
      if (parts.length) lines.push(`#${no}: ${parts.join(', ')}`);
    }
  }
  return lines;
}

/** The schedule (with what payments cover) and its change history, newest first. */
async function fetchPlan(bookingId) {
  const [inst, hist] = await Promise.all([
    supabase.from('v_booking_installments')
      .select('installment_id, installment_no, due_date, amount, covered, remaining, status, is_overdue, days_overdue')
      .eq('booking_id', bookingId).order('installment_no'),
    supabase.from('booking_installment_log')
      .select('log_id, action, before_plan, after_plan, reason, changed_at, manager:changed_by (first_name, last_name)')
      .eq('booking_id', bookingId).order('changed_at', { ascending: false }),
  ]);
  if (inst.error) console.error('Could not load the installment schedule:', inst.error);
  if (hist.error) console.error('Could not load the installment history:', hist.error);
  return { rows: inst.data || [], log: hist.data || [] };
}

function Modal({ title, onClose, children, footer }) {
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4 text-left">{children}</div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

const CANCEL_BTN = 'bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors';
const SAVE_BTN = 'bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER_BTN = 'bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * @param booking    the booking row; needs booking_id, booking_status, payment_plan,
 *                   total_amount, event_datetime and customer.is_suki
 * @param money      the booking's v_booking_money row (net_paid, is_overdue,
 *                   days_overdue, amount_due_now, next_due_date, next_due_amount)
 * @param onChanged  reloads the page after a plan is started, edited or ended
 */
export default function InstallmentPlanCard({ booking, money: m, onChanged }) {
  const onPlan = isInstallmentPlan(booking);
  const isSuki = !!booking?.customer?.is_suki;
  const canStart = !onPlan && isSuki && ['Approved', 'Confirmed'].includes(booking?.booking_status);
  const bookingId = booking?.booking_id;

  const [rows, setRows] = useState([]);
  const [log, setLog] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [dialog, setDialog] = useState(null); // 'start' | 'edit' | 'end'
  const [draft, setDraft] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Only a plan booking has a schedule to read. (A Standard booking's card
  // never renders `rows` or `log`, so they need no clearing.) The state is
  // set in the promise callback, and a reply for a booking this card has
  // since moved off is dropped.
  const current = useRef(bookingId);
  useEffect(() => { current.current = bookingId; }, [bookingId]);
  const load = useCallback(() => {
    if (!bookingId || !onPlan) return Promise.resolve();
    return fetchPlan(bookingId).then(({ rows: r, log: l }) => {
      if (current.current !== bookingId) return;
      setRows(r);
      setLog(l);
    });
  }, [bookingId, onPlan]);

  useEffect(() => {
    if (!bookingId || !onPlan) return undefined;
    let ignore = false;
    fetchPlan(bookingId).then(({ rows: r, log: l }) => {
      if (ignore) return;
      setRows(r);
      setLog(l);
    });
    return () => { ignore = true; };
  }, [bookingId, onPlan]);

  useRealtimeRefresh(
    `installment-plan-${bookingId}`,
    [
      { table: 'booking_installment', filter: `booking_id=eq.${bookingId}` },
      { table: 'payment', filter: `booking_id=eq.${bookingId}` },
      { table: 'booking', filter: `booking_id=eq.${bookingId}` },
    ],
    load,
    { enabled: !!bookingId && onPlan },
  );

  if (!booking || (!onPlan && !canStart)) return null;

  const total = Number(booking.total_amount) || 0;
  const paid = Number(m?.net_paid) || 0;
  const draftCheck = validateSchedule({ total, rows: draft, isNew: dialog === 'start' });
  const afterEventDay = dueAfterEventDate(draft, booking.event_datetime);

  const close = () => { if (!busy) { setDialog(null); setNote(''); } };

  const openStart = () => {
    setDraft(buildEvenSchedule({ total, count: 3, firstDue: todayManila() }));
    setNote('');
    setDialog('start');
  };
  const openEdit = () => {
    setDraft(rows.map(r => ({ due_date: r.due_date, amount: Number(r.amount) })));
    setNote('');
    setDialog('edit');
  };

  const save = async () => {
    if (busy || !draftCheck.ok) return;
    if (dialog === 'edit' && !note.trim()) return;
    setBusy(true);
    const wasApproved = booking.booking_status === 'Approved';
    const { error } = await supabase.rpc('f_save_installment_plan', {
      p_booking_id: bookingId,
      p_installments: toRpcRows(draft),
      p_reason: note.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(dialog === 'start'
      ? (wasApproved ? 'Installment plan saved — booking confirmed.' : 'Installment plan saved.')
      : 'Installment schedule updated.');
    setDialog(null);
    setNote('');
    await load();
    onChanged?.();
  };

  const endPlan = async () => {
    if (busy || !note.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('f_end_installment_plan', { p_booking_id: bookingId, p_reason: note.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.reverted_to_approved
      ? 'Plan ended. Less than 50% is paid, so the booking is back to Approved and flagged for review.'
      : 'Plan ended. The booking is back on the standard rules.');
    setDialog(null);
    setNote('');
    onChanged?.();
  };

  // ---- Standard booking for a suki customer: offer a plan -------------------
  if (!onPlan) {
    return (
      <SectionCard>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="flex items-center gap-2 text-sm text-slate-700">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
              <Star size={12} className="fill-emerald-500 text-emerald-500" /> Suki customer
            </span>
            Can pay this {booking.booking_type === 'Short Order' ? 'order' : 'booking'} in installments instead of a 50% deposit.
          </p>
          <button type="button" onClick={openStart} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-4 py-2 rounded-lg shadow-sm transition-colors">
            Start installment plan
          </button>
        </div>
        {dialog === 'start' && (
          <Modal title="Start installment plan" onClose={close} footer={<>
            <button type="button" onClick={close} disabled={busy} className={CANCEL_BTN}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || !draftCheck.ok} className={SAVE_BTN}>
              {busy ? 'Saving…' : booking.booking_status === 'Approved' ? 'Save plan & confirm booking' : 'Save plan'}
            </button>
          </>}>
            {booking.booking_status === 'Approved' && (
              <p className="text-sm text-slate-700 bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg px-3 py-2">
                Saving the plan confirms this booking immediately, with no deposit needed.
              </p>
            )}
            <InstallmentScheduleEditor total={total} rows={draft} onChange={setDraft} isNew paidSoFar={paid} eventDatetime={booking.event_datetime} />
            <DueAfterEventNote eventDay={afterEventDay} />
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Note <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} placeholder="e.g. Agreed with the customer by phone" />
            </div>
          </Modal>
        )}
      </SectionCard>
    );
  }

  // ---- Installment booking --------------------------------------------------
  const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const canEdit = ['Confirmed', 'Completed'].includes(booking.booking_status);
  const canEnd = !['Rejected', 'Cancelled'].includes(booking.booking_status);

  return (
    <SectionCard>
      <SectionHeader icon={CalendarClock} title={`Installment plan · ${rows.length || m?.installment_count || 0} installments`}>
        {m?.is_overdue && (
          <span className="px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold whitespace-nowrap">
            Overdue {m.days_overdue} day{m.days_overdue === 1 ? '' : 's'}
          </span>
        )}
      </SectionHeader>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Paid <span className="font-bold text-slate-900 tabular-nums">{money(paid)}</span> of <span className="font-bold text-slate-900 tabular-nums">{money(total)}</span></span>
          <span className="text-slate-500 tabular-nums">{Math.round(paidPct)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-[#008A45]" style={{ width: `${paidPct}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-slate-600">Due now <span className={`font-bold tabular-nums ${Number(m?.amount_due_now) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{money(m?.amount_due_now)}</span></span>
          {m?.next_due_date
            ? <span className="text-slate-600">Next: <span className="font-bold text-slate-900 tabular-nums">{money(m.next_due_amount)}</span> on {longYmd(m.next_due_date)}</span>
            : <span className="text-emerald-700 font-semibold">Fully covered</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10.5px] font-bold tracking-[0.1em] uppercase text-slate-600 border-b border-slate-200">
              <th className="py-2 pr-2 w-8">#</th>
              <th className="py-2 pr-2">Due date</th>
              <th className="py-2 pr-2 text-right">Amount</th>
              <th className="py-2 pr-2 text-right">Covered</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.installment_id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-2 text-slate-500 font-semibold">{r.installment_no}</td>
                <td className="py-2 pr-2 text-slate-900">{longYmd(r.due_date)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-900">{money(r.amount)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{money(r.covered)}</td>
                <td className="py-2 text-right">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-bold ${INSTALLMENT_STATUS_PILL[r.status] || INSTALLMENT_STATUS_PILL.Upcoming}`}>
                    {r.status}{r.status === 'Overdue' && r.days_overdue ? ` · ${r.days_overdue}d` : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-5 flex-wrap mt-4 pt-3 border-t border-slate-100">
        {canEdit && <button type="button" onClick={openEdit} disabled={busy} className={ACTION}>Edit schedule</button>}
        {canEnd && <button type="button" onClick={() => { setNote(''); setDialog('end'); }} disabled={busy} className="text-[13px] font-bold text-red-600 hover:text-red-700 disabled:opacity-50">End plan</button>}
        <button type="button" onClick={() => setShowHistory(v => !v)} className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-600 hover:text-slate-900 ml-auto">
          {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />} History ({log.length})
        </button>
      </div>

      {showHistory && (
        <ul className="mt-3 space-y-3">
          {log.map(h => {
            const diff = h.action === 'Updated' ? planDiff(h.before_plan, h.after_plan) : [];
            const who = h.manager ? `${h.manager.first_name} ${h.manager.last_name}` : 'System';
            return (
              <li key={h.log_id} className="text-xs border border-slate-100 rounded-lg p-3 bg-[#fbfcfd]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-bold text-slate-900">{h.action}</span>
                  <span className="text-slate-500">{new Date(h.changed_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })} · {who}</span>
                </div>
                {h.reason && <p className="mt-1 text-slate-700">{h.reason}</p>}
                {h.action === 'Created' && h.after_plan && (
                  <p className="mt-1 text-slate-500">{h.after_plan.length} installments: {h.after_plan.map(r => `${money(r.amount)} on ${shortYmd(r.due_date)}`).join(', ')}</p>
                )}
                {diff.length > 0 && (
                  <ul className="mt-1 text-slate-500 list-disc pl-4">
                    {diff.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
          {log.length === 0 && <li className="text-xs text-slate-500">No changes recorded yet.</li>}
        </ul>
      )}

      {dialog === 'edit' && (
        <Modal title="Edit installment schedule" onClose={close} footer={<>
          <button type="button" onClick={close} disabled={busy} className={CANCEL_BTN}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !draftCheck.ok || !note.trim()} className={SAVE_BTN}>
            {busy ? 'Saving…' : 'Save schedule'}
          </button>
        </>}>
          <InstallmentScheduleEditor total={total} rows={draft} onChange={setDraft} isNew={false} paidSoFar={paid} eventDatetime={booking.event_datetime} />
          <DueAfterEventNote eventDay={afterEventDay} />
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Reason for the change <span className="text-red-500">*</span></label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} placeholder="e.g. Customer asked to move the second payment" />
          </div>
        </Modal>
      )}

      {dialog === 'end' && (
        <Modal title="End installment plan?" onClose={close} footer={<>
          <button type="button" onClick={close} disabled={busy} className={CANCEL_BTN}>Cancel</button>
          <button type="button" onClick={endPlan} disabled={busy || !note.trim()} className={DANGER_BTN}>
            {busy ? 'Ending…' : 'End plan'}
          </button>
        </>}>
          <p className="text-sm text-slate-700">
            The booking goes back to the standard 50% rule. If less than 50% is paid and the event is still ahead, it will return to Approved and be flagged for review.
          </p>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA} placeholder="e.g. Customer will pay normally" />
          </div>
        </Modal>
      )}
    </SectionCard>
  );
}
