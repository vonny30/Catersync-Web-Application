// src/components/ErrorModal.jsx
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function ErrorModal({ isOpen, message, onRetry, onClose }) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">⚠️ Something went wrong</h3>
          {!onRetry && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
          {onRetry ? (
            <>
              <button
                onClick={onClose}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onRetry) onRetry();
                }}
                className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm"
              >
                Retry
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}