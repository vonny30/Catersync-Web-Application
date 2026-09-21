// src/components/RefundMethodField.jsx
//
// How the money went back to the customer. A refund row must name one of the
// three real methods: payment.pay_method is NOT NULL and its CHECK allows only
// Cash, GCash and Bank Transfer, so the old placeholder method 'Refund' is
// refused by the database. Every refund form asks here rather than guessing.
//
// Cash also asks for the number on the paper receipt handed to the customer —
// the same rule Record Receipt follows. That number is the refund's evidence,
// so the proof image becomes optional for Cash (see utils/refundEvidence).
import { RECEIPT_METHODS, methodNeedsReceiptNumber } from '../utils/payments';

export default function RefundMethodField({ value, onChange, receiptNo = '', onReceiptNoChange, error = '', disabled = false }) {
  const needsNumber = methodNeedsReceiptNumber(value) && !!onReceiptNoChange;
  return (
    <div>
      <span className="block text-xs font-bold text-slate-700 mb-1.5">
        Refund Method<span className="text-red-500 ml-1">*</span>
      </span>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Refund method">
        {RECEIPT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`px-2.5 py-2 rounded-lg border text-[13px] font-semibold transition-colors ${
              value === m ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            } ${error && !value ? 'border-red-400' : ''}`}
          >
            {m}
          </button>
        ))}
      </div>
      {error && !value && <p className="text-xs text-red-600 mt-1 font-semibold">{error}</p>}
      {needsNumber && (
        <div className="mt-2">
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Cash Receipt Number<span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="text"
            value={receiptNo}
            onChange={(e) => onReceiptNoChange(e.target.value)}
            disabled={disabled}
            placeholder="The number on the cash receipt given to the customer"
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
          />
        </div>
      )}
    </div>
  );
}
