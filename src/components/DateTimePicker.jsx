// src/components/DateTimePicker.jsx
//
// Drop-in replacement for a single <input type="datetime-local">. Splits
// date and time into their own native pickers — each browser's plain date
// picker and time picker are friendlier to use than the combined
// datetime-local widget — while still producing/accepting the exact same
// "YYYY-MM-DDTHH:mm" string the rest of the app already works with, so
// callers don't need to change how they store or read the value.
//
// Also blocks picking a day that's already passed via the date input's
// native `min`, instead of only catching it after the fact on submit.
import { errorInputClass } from '../utils/formErrors';

function todayDateStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export default function DateTimePicker({ name, value, onChange, hasError, disablePast = true, required }) {
  const [datePart = '', timePart = ''] = value ? value.split('T') : [];

  const emit = (nextDate, nextTime) => {
    const combined = nextDate ? `${nextDate}T${nextTime || '00:00'}` : '';
    onChange({ target: { name, value: combined } });
  };

  const dateClass = errorInputClass(!!hasError, 'w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2');
  const timeClass = errorInputClass(!!hasError, 'w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2');

  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        type="date"
        value={datePart}
        min={disablePast ? todayDateStr() : undefined}
        onChange={(e) => emit(e.target.value, timePart)}
        className={dateClass}
        required={required}
      />
      <input
        type="time"
        value={timePart}
        onChange={(e) => emit(datePart, e.target.value)}
        className={timeClass}
        required={required}
      />
    </div>
  );
}
