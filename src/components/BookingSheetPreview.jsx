// src/components/BookingSheetPreview.jsx
//
// Shows the booking details sheet exactly as it will print, then saves it as
// a PDF from the same page — what is previewed is what is downloaded.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, FileDown } from 'lucide-react';
import { printSheetFrame } from '../utils/bookingSheet';

export default function BookingSheetPreview({ sheet, onClose }) {
  const frameRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-[900px] w-full h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Booking details sheet preview"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Booking Details Sheet</h2>
            <p className="text-[13px] text-slate-500 truncate">Preview of the PDF · A4</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => printSheetFrame(frameRef.current, sheet.title)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#008A45] hover:bg-[#00753a] text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <FileDown size={16} /> Download PDF
            </button>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          title="Booking details sheet"
          srcDoc={sheet.html}
          className="flex-1 w-full border-0 bg-slate-200"
        />
        <p className="px-5 py-2.5 border-t border-slate-200 text-[12.5px] text-slate-500 shrink-0">
          In the print window, choose <b className="font-semibold text-slate-700">Save as PDF</b> as the destination.
        </p>
      </div>
    </div>,
    document.body,
  );
}
