// src/components/PasswordConfirmModal.jsx
//
// Same shell as ConfirmModal.jsx (icon header, white rounded-2xl card,
// Cancel/Confirm footer) with a password field swapped in for the message
// body, since this modal needs input rather than just a yes/no choice.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function PasswordConfirmModal({
  isOpen,
  title,
  message,
  password,
  error,
  verifying,
  onPasswordChange,
  onConfirm,
  onCancel,
}) {
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!verifying) onConfirm(password);
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-red-200">
          <div className="p-2 rounded-full bg-slate-100 text-red-600">
            <AlertTriangle size={20} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <p className="text-sm text-slate-700 leading-relaxed mb-4">{message}</p>

          <label className="text-xs font-bold text-slate-700">Your Password</label>
          <div className="relative mt-1">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Enter your password"
              autoFocus
              disabled={verifying}
              className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all disabled:bg-slate-50 ${error ? 'border-red-300' : 'border-slate-300'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 font-semibold mt-1.5">{error}</p>}

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={verifying}
              className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={verifying}
              className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2"
            >
              {verifying && <Loader2 size={14} className="animate-spin" />}
              {verifying ? 'Verifying...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
