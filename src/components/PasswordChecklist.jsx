// src/components/PasswordChecklist.jsx
import { Check, X } from 'lucide-react';
import { getPasswordChecklist } from '../utils/passwordPolicy';

// Live, per-keystroke feedback on which password rules are satisfied —
// shown next to the field itself instead of only after the manager
// submits the form.
export default function PasswordChecklist({ password }) {
  const checks = getPasswordChecklist(password);

  return (
    <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      {checks.map((check) => (
        <li
          key={check.label}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            check.passed ? 'text-[#008A45]' : 'text-slate-400'
          }`}
        >
          {check.passed ? <Check size={14} className="shrink-0" /> : <X size={14} className="shrink-0" />}
          {check.label}
        </li>
      ))}
    </ul>
  );
}
