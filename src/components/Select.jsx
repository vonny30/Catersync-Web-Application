// src/components/Select.jsx
//
// A drop-in replacement for the native <select> that opens the same kind of
// floating panel as the nav bar's profile menu (rounded-xl, shadow-lg,
// border, fade-in/zoom-in) instead of the browser/OS's native listbox —
// the native one can't be restyled at all once open, which is the actual
// gap a plain CSS chevron swap can't close.
//
// Same shape as <select>: pass `value`, `onChange`, and <option> children.
// onChange is called with a native-shaped event ({ target: { value } }) so
// existing handlers like `(e) => setFoo(e.target.value)` work unchanged.
import { useState, useRef, useEffect, useLayoutEffect, Children } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export default function Select({ value, onChange, className = '', disabled, name, children, ...rest }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Children.toArray flattens nested arrays/fragments — several call sites
  // mix a static <option> with a `{list.map(...)}` block in the same
  // <Select>, which React nests as an array-within-the-children-array.
  // A plain [].map would choke on that nested array (it has no `.props`).
  const options = Children.toArray(children)
    .filter(opt => opt?.props)
    .map(opt => ({
      value: opt.props.value,
      label: opt.props.children,
      disabled: opt.props.disabled,
    }));

  const selected = options.find(o => String(o.value) === String(value));

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  };

  // Computed synchronously before the browser paints the opened menu —
  // otherwise the panel's first frame renders at the stale {top:0,left:0}
  // default (top-left of the page) and only jumps to the right spot once
  // the effect below runs, which is what looked like the dropdown
  // "coming from above" instead of appearing right under the trigger.
  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  const handleSelect = (optValue) => {
    setIsOpen(false);
    // Include `name`, since shared multi-field handlers across this app
    // (handleInputChange, handlePaymentInputChange, etc.) destructure
    // `{ name, value } = e.target` to know which field changed.
    onChange?.({ target: { value: optValue, name } });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(o => !o)}
        className={`inline-flex items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        {...rest}
      >
        <span className="truncate text-left">{selected?.label ?? ''}</span>
        <ChevronDown size={16} className={`shrink-0 text-[#008A45] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, minWidth: menuPos.width }}
          className="z-[9999] max-h-64 overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-200 py-1 animate-in fade-in zoom-in-95 duration-150 origin-top"
        >
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={`${opt.value}-${idx}`}
                type="button"
                disabled={opt.disabled}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-4 py-2 text-sm whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected ? 'bg-[#EAF3F2] text-[#007038] font-semibold' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
