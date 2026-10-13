// src/components/InstallmentScheduleEditor.jsx
//
// The installment schedule as a small form: how many installments (2 to 12),
// one row per installment (due date and amount), and a running check that the
// rows add up to the booking total. Controlled — the parent owns `rows`.
//
// Used by the Approve pop-up (a new plan), and by the plan card's "Start
// installment plan" and "Edit schedule" pop-ups. Errors come from
// validateSchedule (utils/installments.js), the client copy of the database's
// own check. A due date after the event is a WARNING only (allowed for suki
// customers, §9 of the spec) and never blocks saving.
import { Minus, Plus, AlertTriangle } from 'lucide-react';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  MIN_INSTALLMENTS, MAX_INSTALLMENTS, buildEvenSchedule, validateSchedule,
  putDifferenceOnLast, manilaYmd, shortYmd, todayManila,
} from '../utils/installments';

const INPUT = 'w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none';
const money = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * @param total          the booking total the schedule must add up to
 * @param rows           [{ due_date: 'YYYY-MM-DD', amount }] (amount may be a string while typing)
 * @param onChange       (rows) => void
 * @param isNew          a new plan: the first due date may not be before today
 * @param paidSoFar      verified net money already paid (applied oldest first)
 * @param eventDatetime  the event, for the "due after the event" warning
 */
export default function InstallmentScheduleEditor({ total, rows, onChange, isNew, paidSoFar = 0, eventDatetime }) {
  const { showConfirm } = useConfirm();
  const check = validateSchedule({ total, rows, isNew });
  const eventDay = manilaYmd(eventDatetime);
  const firstDue = rows[0]?.due_date || todayManila();

  // True when the rows are not simply the even split for this count, i.e. the
  // manager has typed dates or amounts by hand.
  const handTyped = () => {
    const even = buildEvenSchedule({ total, count: rows.length, firstDue });
    return rows.some((r, i) => r.due_date !== even[i]?.due_date || Math.round(Number(r.amount) * 100) !== Math.round(even[i]?.amount * 100));
  };

  const regenerate = async (count) => {
    if (!isNew && rows.length && handTyped()) {
      const ok = await showConfirm({
        title: 'Replace the schedule?',
        message: `This replaces the current rows with ${count} even monthly installments from ${shortYmd(firstDue)}. Dates and amounts you typed will be lost.`,
        confirmLabel: 'Replace rows',
        confirmVariant: 'warning',
      });
      if (!ok) return;
    }
    onChange(buildEvenSchedule({ total, count, firstDue }));
  };

  const setRow = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  // How many rows verified payments already cover, oldest first.
  let covered = 0;
  if (paidSoFar > 0) {
    let running = 0;
    for (const r of rows) {
      running += Number(r.amount) || 0;
      if (paidSoFar + 0.005 >= running) covered += 1;
      else break;
    }
  }

  const count = rows.length;
  const diff = check.difference;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">Installments</span>
          <div className="inline-flex items-center border border-slate-300 rounded-lg overflow-hidden">
            <button type="button" aria-label="One fewer installment" disabled={count <= MIN_INSTALLMENTS}
              onClick={() => regenerate(count - 1)}
              className="px-2 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <Minus size={14} />
            </button>
            <span className="px-3 text-sm font-bold text-slate-900 tabular-nums">{count}</span>
            <button type="button" aria-label="One more installment" disabled={count >= MAX_INSTALLMENTS}
              onClick={() => regenerate(count + 1)}
              className="px-2 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <button type="button" onClick={() => regenerate(count)}
          className="text-xs font-bold text-[#007038] hover:text-[#00532a]">
          Split evenly
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const afterEvent = eventDay && r.due_date && r.due_date > eventDay;
          return (
            <div key={i}>
              <div className="grid grid-cols-[28px_1fr_1fr] gap-2 items-center">
                <span className="text-xs font-bold text-slate-500 text-center">{i + 1}</span>
                <input type="date" aria-label={`Installment ${i + 1} due date`} value={r.due_date || ''}
                  onChange={(e) => setRow(i, 'due_date', e.target.value)}
                  className={`${INPUT} ${check.rowErrors[i] ? 'border-red-400' : ''}`} />
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">₱</span>
                  <input type="number" inputMode="decimal" min="0" step="0.01" aria-label={`Installment ${i + 1} amount`}
                    value={r.amount} onChange={(e) => setRow(i, 'amount', e.target.value)}
                    className={`${INPUT} pl-6 tabular-nums ${check.rowErrors[i] ? 'border-red-400' : ''}`} />
                </div>
              </div>
              {check.rowErrors[i] && <p className="ml-[36px] mt-1 text-xs text-red-600">{check.rowErrors[i]}</p>}
              {!check.rowErrors[i] && afterEvent && (
                <p className="ml-[36px] mt-1 text-xs text-amber-700">
                  Due after the event ({shortYmd(eventDay)}). Allowed for suki customers. Make sure this was agreed.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-200 pt-3">
        <p className="text-sm text-slate-700">
          Schedule <span className="font-bold tabular-nums">{money(check.sum)}</span> of <span className="font-bold tabular-nums">{money(total)}</span>
          {Math.abs(diff) >= 0.005 && (
            <span className="ml-2 text-red-600 font-semibold tabular-nums">
              ({diff > 0 ? `${money(diff)} short` : `${money(-diff)} over`})
            </span>
          )}
        </p>
        {Math.abs(diff) >= 0.005 && (
          <button type="button" onClick={() => onChange(putDifferenceOnLast(rows, total))}
            className="text-xs font-bold text-[#007038] hover:text-[#00532a]">
            Put difference on last
          </button>
        )}
      </div>
      {check.formError && Object.keys(check.rowErrors).length === 0 && (
        <p className="text-xs text-red-600">{check.formError}</p>
      )}

      {paidSoFar > 0 && (
        <p className="text-xs text-slate-500">
          {money(paidSoFar)} is already paid. Payments are applied oldest first, so {covered === 0 ? 'no installment is' : covered === 1 ? 'installment 1 is' : `installments 1–${covered} are`} already covered.
        </p>
      )}
    </div>
  );
}

/** The one-line note the pop-ups show when any installment is due after the event. */
export function DueAfterEventNote({ eventDay }) {
  if (!eventDay) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <AlertTriangle size={14} className="shrink-0 mt-px" />
      Some installments are due after the event ({shortYmd(eventDay)}). This is allowed for suki customers. Make sure it was agreed.
    </p>
  );
}
