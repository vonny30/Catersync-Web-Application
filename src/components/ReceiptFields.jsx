// src/components/ReceiptFields.jsx
//
// The body of every "Record Receipt" form: amount, method, and the proof the
// method actually has. Shared by the Receivables page and both booking detail
// pages so the three forms cannot drift apart.
//
// Cash has a paper receipt, so it asks for the receipt number (required) and
// takes an image only if there is one. GCash and bank transfers have a digital
// trail, so they require the screenshot and never ask for a number. Switching
// method clears the field that no longer applies, so a stale value is never
// saved (the parent does the clearing in onMethodChange).
//
// The stage is shown read-only. The manager does not choose it: it follows
// from the money already in (stageForReceipt), and the line below the amount
// says what this receipt will be recorded as before anything is saved.
import ImageUploadField from './ImageUploadField';
import { RECEIPT_METHODS, methodNeedsReceiptNumber, stageForReceipt, payStatusPillClass } from '../utils/payments';

export default function ReceiptFields({
  amount,
  onAmountChange,
  method,
  onMethodChange,
  receiptReference,
  onReceiptReferenceChange,
  file,
  onFileChange,
  errors = {},
  priorPaid = 0,
  total = 0,
  disabled = false,
}) {
  const value = Number(amount) || 0;
  const owed = Number(total) || 0;
  const remaining = Math.max(0, owed - (Number(priorPaid) || 0));
  const isFirst = (Number(priorPaid) || 0) <= 0;
  const stage = value > 0 ? stageForReceipt({ priorPaid, amount: value, total: owed }) : null;
  const needsNumber = methodNeedsReceiptNumber(method);
  const inputClass = (hasError) => `w-full border rounded-lg p-2.5 text-sm focus:ring-2 outline-none ${
    hasError ? 'border-red-400 focus:ring-red-200 focus:border-red-400 bg-red-50/40' : 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45] bg-white'
  }`;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="receipt-amount" className="block text-xs font-bold text-slate-700 mb-1">Amount (₱)</label>
        <input
          id="receipt-amount"
          type="number"
          name="amount"
          value={amount}
          onChange={onAmountChange}
          placeholder="0.00"
          step="0.01"
          min="0"
          disabled={disabled}
          className={inputClass(!!errors.amount)}
        />
        {errors.amount ? (
          <p className="text-xs text-red-600 mt-1 font-semibold">{errors.amount}</p>
        ) : owed > 0 ? (
          <p className="text-xs text-slate-600 mt-1">
            {isFirst
              ? `First receipt: at least 50% of the total (₱${(owed * 0.5).toLocaleString()}), up to ₱${remaining.toLocaleString()}.`
              : `Up to the remaining balance of ₱${remaining.toLocaleString()}.`}
          </p>
        ) : null}
        {stage && !errors.amount && (
          <p className="flex items-center gap-1.5 text-[13px] text-slate-700 mt-2">
            This will be recorded as
            <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${payStatusPillClass(stage)}`}>{stage}</span>
          </p>
        )}
      </div>

      <div>
        <span className="block text-xs font-bold text-slate-700 mb-2">Payment Method</span>
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Payment method">
          {RECEIPT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              disabled={disabled}
              onClick={() => onMethodChange(m)}
              className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-semibold transition-all ${method === m ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900 shadow-xs' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            >
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${method === m ? 'border-[#008A45]' : 'border-slate-400'}`}>
                {method === m && <span className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
              </span>
              {m}
            </button>
          ))}
        </div>
      </div>

      {needsNumber && (
        <div>
          <label htmlFor="receipt-reference" className="block text-xs font-bold text-slate-700 mb-1">
            Receipt number<span className="text-red-500 ml-1">*</span>
          </label>
          <input
            id="receipt-reference"
            type="text"
            name="receipt_reference"
            value={receiptReference}
            onChange={onReceiptReferenceChange}
            placeholder="The number printed on the cash receipt you issued"
            maxLength={60}
            disabled={disabled}
            className={inputClass(!!errors.receipt)}
          />
          {errors.receipt && <p className="text-xs text-red-600 mt-1 font-semibold">{errors.receipt}</p>}
        </div>
      )}

      <ImageUploadField
        label="Proof of Payment"
        required={!needsNumber}
        note={needsNumber ? '(optional for cash)' : ''}
        file={file}
        onChange={onFileChange}
        error={errors.file}
        hint="PNG, JPG up to 5MB. Stored in Supabase Storage."
        disabled={disabled}
      />
    </div>
  );
}
