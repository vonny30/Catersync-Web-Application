// src/components/ConfirmModal.jsx
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Info } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmVariant,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      confirm: 'bg-red-600 hover:bg-red-700 text-white',
      icon: 'text-red-600',
      border: 'border-red-200',
    },
    warning: {
      confirm: 'bg-amber-600 hover:bg-amber-700 text-white',
      icon: 'text-amber-600',
      border: 'border-amber-200',
    },
    success: {
      confirm: 'bg-[#008A45] hover:bg-[#007038] text-white',
      icon: 'text-[#008A45]',
      border: 'border-[#008A45]',
    },
  };

  const styles = variantStyles[confirmVariant] || variantStyles.danger;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className={`flex items-center gap-3 px-6 py-4 border-b ${styles.border}`}>
          <div className={`p-2 rounded-full bg-slate-100 ${styles.icon}`}>
            {confirmVariant === 'danger' ? (
              <AlertTriangle size={20} />
            ) : (
              <Info size={20} />
            )}
          </div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
  {message}
</p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button
            onClick={onCancel}
            className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
          >
            {cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className={`${styles.confirm} font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm`}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}