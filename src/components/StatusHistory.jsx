// src/components/StatusHistory.jsx
//
// "Why did this change?" — answered from booking_status_log, which a database
// trigger writes on every status change whatever caused it: the 50% auto-
// confirm, the auto-revert when a reversal drops a booking back below the
// threshold, a manager override, or an ordinary manual change.
//
// This screen exists because a booking that moves on its own is otherwise
// indistinguishable from one a colleague changed, and the manager is left
// guessing. Nothing here writes; the log is append-only and owned by the
// database.
import { useState, useEffect } from 'react';
import { History } from 'lucide-react';
import { supabase } from '../supabase';

// How the four sources read to someone who did not write the trigger.
const SOURCE_TONE = {
  'Auto-confirm (50% threshold)': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Auto-revert (reversal below 50% threshold)': 'bg-amber-50 text-amber-800 border-amber-200',
  'Manager override': 'bg-blue-50 text-blue-700 border-blue-200',
  Manual: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ORDER BY seq, NOT changed_at. changed_at is now(), the transaction clock,
// so every row written inside one transaction carries the identical instant —
// approve, the 50% auto-confirm it fires, the auto-revert a reversal fires.
// Sorted by time with a uuid tiebreak, a three-step chain printed in a random
// order, which is how this was found. `seq` is an identity column added for
// exactly this; its own column comment says not to sort by changed_at.

const formatWhen = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

export default function StatusHistory({ bookingId, refreshKey = 0, limit = 5 }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data, error } = await supabase
        .from('booking_status_log')
        .select('log_id, seq, from_status, to_status, source, reason, changed_at')
        .eq('booking_id', bookingId)
        .order('seq', { ascending: false })
        .limit(limit);
      if (ignore) return;
      if (error) console.error('Could not load the status history:', error);
      setRows(data || []);
      setLoaded(true);
    })();
    return () => { ignore = true; };
  }, [bookingId, refreshKey, limit]);

  // Nothing to show is the normal case for a booking that has not moved since
  // the log was added, so it says that rather than rendering an empty box.
  if (!loaded) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 mb-1">
        <History size={15} className="text-slate-500" /> Status History
      </h3>
      <p className="text-[12.5px] text-slate-500 mb-3">
        Every status change, including the ones the system made on its own.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No status changes recorded yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(row => (
            <li key={row.log_id} className="text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-slate-900 whitespace-nowrap">
                  {row.from_status || '—'} → {row.to_status}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${SOURCE_TONE[row.source] || SOURCE_TONE.Manual}`}>
                  {row.source}
                </span>
                <span className="text-[12.5px] text-slate-500 tabular-nums whitespace-nowrap">{formatWhen(row.changed_at)}</span>
              </div>
              {row.reason && (
                <p className="text-[12.5px] text-slate-600 mt-0.5">{row.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
