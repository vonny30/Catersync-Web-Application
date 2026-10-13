// src/components/ApprovalPaymentChoice.jsx
//
// The payment part of every Approve pop-up — the shared ApprovalModal (Bookings,
// Short Orders, Overview) and the two detail pages' own copies — so the
// choice reads and behaves the same wherever a booking is approved.
//
// For a suki customer: Standard (50% deposit, the default and the old
// behaviour) or an Installment plan, with the schedule editor fed the same
// final total the pop-up shows. For everyone else nothing changes: the choice
// renders nothing and the deposit line is the old one, word for word.
//
// The state lives in useApprovalHandlers (`installment`).
import { Star } from 'lucide-react';
import InstallmentScheduleEditor, { DueAfterEventNote } from './InstallmentScheduleEditor';
import { PAYMENT_PLAN, dueAfterEventDate, longYmd } from '../utils/installments';

const money = (n) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The small badge beside a suki customer's name. */
export function SukiBadge() {
  return (
    <span className="inline-flex items-center gap-1 ml-1.5 px-1.5 py-px rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold align-middle">
      <Star size={10} className="fill-emerald-500 text-emerald-500" /> Suki
    </span>
  );
}

/**
 * Standard or Installment plan, and the schedule when a plan is chosen.
 * @param installment  from useApprovalHandlers
 * @param total        the new total the pop-up shows (and the approval writes)
 * @param eventDatetime the booking's event, for the after-event warning
 */
export default function ApprovalPaymentChoice({ installment, total, eventDatetime }) {
  if (!installment?.isSuki) return null;
  const choose = (value) => installment.setChoice(value);
  const option = (value, label, hint) => (
    <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
      installment.choice === value ? 'border-[#008A45] bg-[#EAF3F2]' : 'border-slate-200 bg-white hover:bg-slate-50'
    }`}>
      <input type="radio" name="payment-plan" className="mt-0.5 accent-[#008A45]"
        checked={installment.choice === value} onChange={() => choose(value)} />
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-slate-700">Payment</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {option(PAYMENT_PLAN.standard, 'Standard (50% deposit)', 'Confirmed once half is paid and verified.')}
        {option(PAYMENT_PLAN.installment, 'Installment plan', 'Suki customer: pays in parts, no deposit needed.')}
      </div>
      {installment.isInstallment && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
          <p className="text-sm font-semibold text-[#00603a]">Approving will confirm this booking immediately.</p>
          <InstallmentScheduleEditor total={total} rows={installment.rows} onChange={installment.setRows} isNew eventDatetime={eventDatetime} />
          <DueAfterEventNote eventDay={dueAfterEventDate(installment.rows, eventDatetime)} />
        </div>
      )}
    </div>
  );
}

/**
 * The line under the new total: the 50% deposit, or — on an installment plan —
 * the first installment and its due date.
 * @param depositNote  the small print each pop-up already shows under the deposit
 */
export function ApprovalDepositLine({ installment, total, depositNote }) {
  if (installment?.isInstallment) {
    const first = installment.rows[0];
    return (
      <div className="text-sm text-slate-500">
        <p>First installment: <span className="font-bold">{money(first?.amount)}</span>{first?.due_date ? ` due ${longYmd(first.due_date)}` : ''}</p>
        <p className="text-xs mt-1">No deposit is needed on an installment plan.</p>
      </div>
    );
  }
  return (
    <div className="text-sm text-slate-500">
      <p>Deposit (50%): <span className="font-bold">{money(total * 0.5)}</span></p>
      <p className="text-xs mt-1">{depositNote}</p>
    </div>
  );
}
