// src/utils/bookingSheet.js
//
// The one-page "Booking Details" sheet the kitchen and staff work from —
// a clean version of the paper form PG's Catering already uses (date, name,
// contact, venue, time, package, pax, motif, menu, notes). No money on it:
// it is a working sheet, not a statement.
//
// Built as one standalone HTML page, used twice: shown in the preview modal
// (components/BookingSheetPreview.jsx) and printed from there. The PDF is
// real text (sharp, searchable, small) and needs no PDF library; the
// browser's print dialog saves it, and the file name comes from the title.

import { formatPhone } from './businessProfile';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fmtDate = (dt) => (dt
  ? new Date(dt).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  : '—');
const fmtTime = (dt) => (dt
  ? new Date(dt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  : '—');

const STYLES = `
  @page { size: A4; margin: 16mm 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  /* On screen (the preview) the sheet sits on a grey desk as an A4 page. */
  @media screen {
    html { background: #e2e8f0; }
    .page { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 16mm; background: #fff;
            box-shadow: 0 2px 12px rgba(15, 23, 42, 0.12); }
  }
  @media screen and (max-width: 840px) {
    .page { width: auto; min-height: 0; margin: 0; padding: 20px 16px; box-shadow: none; }
  }
  body { font-family: 'Segoe UI', Inter, Roboto, Arial, sans-serif; color: #0f172a; font-size: 12.5pt; line-height: 1.45;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; align-items: center; gap: 18px; padding-bottom: 14px; border-bottom: 2px solid #0f6b3c; }
  .head img { width: 74px; height: 74px; object-fit: contain; }
  .biz { flex: 1; }
  .biz h1 { margin: 0; font-size: 18pt; letter-spacing: -0.01em; }
  .biz p { margin: 2px 0 0; font-size: 10.5pt; color: #475569; }
  .title { display: flex; align-items: baseline; justify-content: space-between; margin: 20px 0 12px; }
  .title h2 { margin: 0; font-size: 13pt; letter-spacing: 0.14em; text-transform: uppercase; }
  .title span { font-size: 10.5pt; color: #475569; }
  .title b { color: #0f172a; }
  table.fields { width: 100%; border-collapse: collapse; }
  table.fields th { width: 34%; text-align: left; font-weight: 600; color: #475569; font-size: 10.5pt;
                    text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 12px 8px 0; vertical-align: top; }
  table.fields td { padding: 7px 0; font-weight: 600; }
  table.fields tr + tr th, table.fields tr + tr td { border-top: 1px solid #e2e8f0; }
  .section { margin-top: 22px; }
  .section h3 { margin: 0 0 8px; font-size: 10.5pt; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; }
  ol.menu { margin: 0; padding: 0; list-style: none; counter-reset: m; border: 1px solid #e2e8f0; border-radius: 8px; }
  ol.menu li { counter-increment: m; display: flex; align-items: baseline; gap: 12px; padding: 8px 14px; }
  ol.menu li + li { border-top: 1px solid #f1f5f9; }
  ol.menu li::before { content: counter(m) "."; width: 22px; color: #94a3b8; font-weight: 600; }
  ol.menu .name { flex: 1; font-weight: 600; }
  ol.menu .detail { color: #64748b; font-size: 10.5pt; }
  .empty { color: #94a3b8; font-style: italic; }
  .notes { min-height: 90px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; white-space: pre-wrap; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;
          font-size: 9pt; color: #94a3b8; }
`;

/**
 * The booking sheet as a standalone HTML page, and the title its PDF is
 * saved under.
 * @param business  from useBusinessProfile()
 * @param booking   the booking row with `customer` joined
 * @param packageLabel  package name, or "Short Order"
 * @param menu      [{ name, detail }] — detail is the category or "× 3 trays"
 * @param notes     display-ready notes (displayNotes())
 */
export function buildBookingSheet({ business, booking, packageLabel, menu, notes }) {
  const number = booking.booking_number || '';
  const customerName = [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || '—';
  const contact = [formatPhone(business.phone), business.email].filter(Boolean).join(' · ');

  const fields = [
    ['Date', fmtDate(booking.event_datetime)],
    ['Time', fmtTime(booking.event_datetime)],
    ['Name', customerName],
    ['Contact number', formatPhone(booking.customer?.contact_no) || '—'],
    ['Venue', booking.venue || '—'],
    ['Package', packageLabel || '—'],
    ['No. of pax', booking.pax_count ? Number(booking.pax_count).toLocaleString() : '—'],
    ['Motif / color', booking.motif_color || '—'],
  ];

  const menuHtml = (menu || []).length
    ? `<ol class="menu">${menu.map(m => `<li><span class="name">${esc(m.name)}</span>${m.detail ? `<span class="detail">${esc(m.detail)}</span>` : ''}</li>`).join('')}</ol>`
    : '<p class="empty">No menu selected yet.</p>';

  const title = `${number ? `${number} ` : ''}Booking Details - ${customerName}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLES}</style></head><body><div class="page">
    <header class="head">
      <img src="${esc(`${window.location.origin}/logo.png`)}" alt="">
      <div class="biz">
        <h1>${esc(business.business_name)}</h1>
        ${business.address ? `<p>${esc(business.address)}</p>` : ''}
        ${contact ? `<p>${esc(contact)}</p>` : ''}
      </div>
    </header>
    <div class="title">
      <h2>Booking Details</h2>
      <span>${number ? `<b>${esc(number)}</b> · ` : ''}${esc(booking.booking_status || '')}</span>
    </div>
    <table class="fields">${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    <div class="section"><h3>Menu</h3>${menuHtml}</div>
    <div class="section"><h3>Notes</h3><div class="notes">${notes ? esc(notes) : ''}</div></div>
    <footer class="foot"><span>${esc(business.business_name)} · CaterSync</span><span>Printed ${esc(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></footer>
  </div></body></html>`;

  return { html, title };
}

/**
 * Opens the print dialog for a sheet already loaded in an iframe (the
 * preview). Borrows the sheet's title meanwhile: most browsers name the
 * saved PDF after the page title.
 */
export function printSheetFrame(frame, title) {
  const previousTitle = document.title;
  document.title = title;
  frame.contentWindow.focus();
  frame.contentWindow.print();
  document.title = previousTitle;
}
