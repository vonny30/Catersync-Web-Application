// src/components/BookingSheetPreview.jsx
//
// Shows the booking details sheet as it will be saved, then downloads it as
// a PDF or a PNG named Name_BookingNo — what is previewed is what is saved.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileDown, ImageDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadSheetPdf, downloadSheetImage } from '../utils/bookingSheet';

export default function BookingSheetPreview({ sheet, onClose }) {
  const [busy, setBusy] = useState(null); // 'pdf' | 'png' | null

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async (kind) => {
    setBusy(kind);
    try {
      await (kind === 'pdf' ? downloadSheetPdf(sheet) : downloadSheetImage(sheet));
    } catch (err) {
      console.error('Booking sheet download failed:', err);
      toast.error("Couldn't create the file. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait';

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-[900px] w-full h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Booking details sheet preview"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Booking Details Sheet</h2>
            <p className="text-[13px] text-slate-500 truncate">Saves as <span className="font-semibold text-slate-700">{sheet.fileName}</span></p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" disabled={!!busy} onClick={() => download('png')}
              className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
              {busy === 'png' ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />} Image
            </button>
            <button type="button" disabled={!!busy} onClick={() => download('pdf')}
              className={`${btn} bg-[#008A45] hover:bg-[#00753a] text-white`}>
              {busy === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} PDF
            </button>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>
        </div>
        <iframe
          title="Booking details sheet"
          srcDoc={sheet.html}
          className="flex-1 w-full border-0 bg-slate-200"
        />
      </div>
    </div>,
    document.body,
  );
}
