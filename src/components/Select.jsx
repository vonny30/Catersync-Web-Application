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

  // The plain text of an option label, for the `title` on a truncated option.
  //
  // NOT `typeof label === 'string'`. Most call sites build a label out of an
  // expression — <option>{name} — {qty} in stock</option> — which React hands
  // over as an ARRAY of children, not a string. A string check therefore fails
  // on exactly the long, composed labels most likely to be ellipsised, and
  // leaves them with no way to read the full text. Flattening covers arrays and
  // nested elements, and yields '' for anything with no text (an icon), which
  // the caller turns back into no title at all.
  const labelText = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(labelText).join('');
    if (node.props?.children !== undefined) return labelText(node.props.children);
    return '';
  };

  const MENU_MAX_HEIGHT = 256; // matches max-h-64 on the panel
  const GAP = 4;
  // How wide the panel may grow beyond its trigger. This ceiling is the whole
  // reason the panel is allowed to grow at all — see the note on the panel's
  // style block. 320px comfortably holds the longest option in the app while
  // staying narrower than every modal that contains a Select.
  const MENU_MAX_WIDTH = 320;
  const VIEWPORT_MARGIN = 16;

  const computePosition = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when there isn't room below and there's more
    // room above — otherwise a select near the bottom of a modal opens into
    // the viewport edge and its lower options can't be reached.
    const flipUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && rect.top > spaceBelow;

    return {
      top: flipUp ? undefined : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : undefined,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, (flipUp ? rect.top : spaceBelow) - GAP * 2),
      // Recomputed here, alongside every other measurement, so it stays right
      // through scroll and resize rather than being a one-shot guess.
      maxWidth: Math.min(MENU_MAX_WIDTH, window.innerWidth - rect.left - VIEWPORT_MARGIN),
    };
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
          style={{
            position: 'fixed',
            top: menuPos.top,
            bottom: menuPos.bottom,
            left: menuPos.left,
            // TWO FAILURE MODES, ONE BOUNDED RANGE. Read both before changing
            // either — this has swung between them once already.
            //
            //   minWidth alone (the original) let a long option stretch the
            //   panel to whatever its widest label needed. The Assign modal's
            //   equipment list ran nearly the full screen width, off the side
            //   of the modal containing it.
            //
            //   width alone (the fix for that) pinned the panel to the TRIGGER,
            //   which is sized by its current value. A 66px trigger showing
            //   "All" gave a 66px panel that had to hold "Short Orders" — which
            //   wrapped onto four lines and broke "Packages" mid-word into
            //   "Pack / ages".
            //
            // The trigger width is a FLOOR, not a fixed size, and maxWidth is
            // the ceiling the first version lacked. The panel grows to fit its
            // widest option and cannot escape either the viewport or a modal.
            minWidth: menuPos.width,
            maxWidth: menuPos.maxWidth,
            maxHeight: menuPos.maxHeight,
          }}
          // overflow-x-hidden is deliberately absent: it clipped the panel
          // rather than letting it size to its content. Vertical scrolling for
          // a long list is still right.
          className="z-[9999] overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-200 py-1"
        >
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            // An option label is a short noun phrase and must never wrap: the
            // panel widens to fit it instead. Past the 320px ceiling it is
            // ellipsised rather than wrapped, and the title carries the full
            // text — truncation with no way to read the whole value is not an
            // acceptable trade.
            const title = labelText(opt.label) || undefined;
            return (
              <button
                key={`${opt.value}-${idx}`}
                type="button"
                disabled={opt.disabled}
                title={title}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-4 py-2 text-sm leading-snug whitespace-nowrap overflow-hidden text-ellipsis transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
