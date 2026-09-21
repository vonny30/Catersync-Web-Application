// src/components/ReviewFlagBanner.jsx
//
// The system changed this booking and wants a manager to look at it.
//
// The flag is set by the database — today by the demotion that follows a
// reversal — and cleared here, by a person, which is the whole point: an
// automated control that corrects itself silently is not a control. Clearing
// it is a plain acknowledgement, not an approval of anything.
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';

export default function ReviewFlagBanner({ bookingId, reason, flaggedAt, onCleared }) {
  const [clearing, setClearing] = useState(false);

  const markReviewed = async () => {
    setClearing(true);
    try {
      // Only the three flag columns. The status the flag is about is not
      // touched here — reviewing is not confirming.
      const { error } = await supabase
        .from('booking')
        .update({ flagged_for_review: false, flag_reason: null, flagged_at: null })
        .eq('booking_id', bookingId);
      if (error) throw error;
      toast.success('Marked as reviewed.');
      onCleared?.();
    } catch (error) {
      console.error(error);
      toast.error('Could not clear the review flag.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-amber-900">Needs review</p>
          <p className="text-[13px] text-amber-900/90 mt-0.5">
            {reason || 'Changed by the system.'}
          </p>
          {flaggedAt && (
            <p className="text-[12px] text-amber-800/80 mt-0.5 tabular-nums">
              Flagged {new Date(flaggedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={markReviewed}
        disabled={clearing}
        className="shrink-0 rounded-[10px] border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 transition-colors"
      >
        {clearing ? 'Clearing…' : 'Reviewed'}
      </button>
    </div>
  );
}
