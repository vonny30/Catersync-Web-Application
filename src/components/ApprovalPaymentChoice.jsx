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
import InstallmentScheduleEditor, { DueAfterEventNote } from './InstallmentScheduleEditor';
import { PAYMENT_PLAN, dueAfterEventDate, longYmd } from '../utils/installments';

const money = (n) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
 * The white panel of an Approve pop-up, used by all three. For a suki customer
 * (`wide`) it is wider and two columns on a large screen: the customer
 * details, the date's availability and the fees on the left; the new total and
 * the payment choice on the right, staying in view while the left side
 * scrolls. On a small screen the columns stack. For everyone else the panel is
 * exactly the old single column: details, then payment, then the footer.
 * @param header   the title row
 * @param details  customer card, availability check, fee inputs
 * @param payment  new total, payment choice, deposit / first-installment line
 * @param footer   the shortage warning (if any) and the buttons
 */
export function ApprovalPanel({ wide, header, details, payment, footer }) {
  return (
    <div className={`bg-white rounded-xl shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'} w-full max-h-[90vh] flex flex-col overflow-hidden`}>
      {header}
      {wide ? (
        <div className="p-6 overflow-y-auto bg-[#fbfcfd] text-left">
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="space-y-6 min-w-0">{details}</div>
            <div className="space-y-6 min-w-0 lg:sticky lg:top-0">{payment}</div>
          </div>
          <div className="space-y-6 mt-6">{footer}</div>
        </div>
      ) : (
        <div className="p-6 overflow-y-auto space-y-6 bg-[#fbfcfd] text-left">
          {details}
          {payment}
          {footer}
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
