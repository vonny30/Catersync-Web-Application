// src/components/Select.jsx
//
// A drop-in replacement for the native <select> that opens the same kind of
// floating panel as the nav bar's profile menu (rounded-xl, shadow-lg,
// border) instead of the browser/OS's native listbox — the native one
// can't be restyled at all once open, which is the actual gap a plain CSS
// chevron swap can't close.
//
// Same shape as <select>: pass `value`, `onChange`, and <option> children.
// onChange is called with a native-shaped event ({ target: { value } }) so
// existing handlers like `(e) => setFoo(e.target.value)` work unchanged.
import { useState, useEffect, useRef, Children } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export default function Select({ value, onChange, className = '', disabled, name, children, ...rest }) {
  // `menuPos` doubles as the open/closed flag: null = closed, an object =
  // open AND where to draw it. The two can never disagree with each other
  // this way — there is no separate "isOpen" state that could render one
  // frame before "where" is known. That mismatch (menu opens with isOpen
  // before its position effect had run, defaulting to {top:0,left:0} —
  // the page's top-left, right under the nav bar) is what was seen as the
  // dropdown "coming from the nav bar."
  const [menuPos, setMenuPos] = useState(null);
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

  const computePosition = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left, width: rect.width };
  };

  const toggleOpen = () => {
    setMenuPos(current => (current ? null : computePosition()));
  };
  const close = () => setMenuPos(null);

  useEffect(() => {
    if (!menuPos) return;
    const reposition = () => setMenuPos(computePosition());
    const handleClickOutside = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      close();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!menuPos]);

  const handleSelect = (optValue) => {
    close();
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
        onClick={toggleOpen}
        className={`inline-flex items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        {...rest}
      >
        <span className="truncate text-left">{selected?.label ?? ''}</span>
        <ChevronDown size={16} className={`shrink-0 text-[#008A45] transition-transform duration-200 ${menuPos ? 'rotate-180' : ''}`} />
      </button>

      {menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, minWidth: menuPos.width }}
          className="z-[9999] max-h-64 overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-200 py-1"
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
