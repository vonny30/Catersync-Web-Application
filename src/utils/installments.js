// src/utils/installments.js
//
// Installment payment plans for suki (loyal) customers: the plan names, date
// math in the business's own calendar (Manila), an even split, and a client
// copy of the database's schedule check so the editor can show problems as
// the manager types.
//
// The database stays the authority: private.f_check_installments refuses any
// schedule this file lets through by mistake, and its messages are shown as
// they are. Spec: docs/feature-suki-installments.md (§2 R5, §5.1).

export const PAYMENT_PLAN = { standard: 'Standard', installment: 'Installment' };

/** True when the booking is paid on an installment plan. */
export const isInstallmentPlan = (b) => b?.payment_plan === PAYMENT_PLAN.installment;

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 12;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today in Manila as 'YYYY-MM-DD' (matches private.f_today_manila()). */
export const todayManila = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

/** A timestamp's calendar day in Manila, as 'YYYY-MM-DD' (null when empty). */
export const manilaYmd = (value) => (value
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(value))
  : null);

/** True for a real calendar date written as 'YYYY-MM-DD' (rejects 2026-02-30). */
export function isValidYmd(ymd) {
  const m = YMD.exec(ymd || '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * Adds whole months to a 'YYYY-MM-DD', clamping to the month's last day
 * (Jan 31 + 1 month = Feb 28, or Feb 29 in a leap year). Pure UTC date math,
 * so the browser's time zone can never shift the day.
 */
export function addMonthsYmd(ymd, n) {
  const m = YMD.exec(ymd || '');
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + n;
  const d = Number(m[3]);
  const targetYear = y + Math.floor(mo / 12);
  const targetMonth = ((mo % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * An even split of `total` into `count` monthly installments from `firstDue`,
 * worked in centavos; any remainder goes on the LAST row
 * (₱10,000 in 3 = 3,333.33 + 3,333.33 + 3,333.34).
 */
export function buildEvenSchedule({ total, count, firstDue }) {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => ({
    due_date: addMonthsYmd(firstDue, i),
    amount: (i === count - 1 ? cents - base * (count - 1) : base) / 100,
  }));
}

const toCents = (v) => Math.round(Number(v) * 100);
const hasMoreThanTwoDecimals = (v) => {
  const s = String(v).trim();
  const dot = s.indexOf('.');
  return dot !== -1 && s.slice(dot + 1).replace(/0+$/, '').length > 2;
};
const peso = (cents) => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Mirror of private.f_check_installments, for instant feedback.
 * @param total  the booking total the schedule must add up to
 * @param rows   [{ due_date: 'YYYY-MM-DD', amount }]
 * @param isNew  a new plan (the first due date may not be before today)
 * @returns {{ ok: boolean, rowErrors: Record<number, string>, formError: string|null, sum: number, difference: number }}
 *   sum and difference (total − sum) are in pesos.
 */
export function validateSchedule({ total, rows, isNew, today = todayManila() }) {
  const rowErrors = {};
  let formError = null;
  const list = rows || [];
  const totalCents = toCents(total || 0);
  let sumCents = 0;

  if (list.length < MIN_INSTALLMENTS || list.length > MAX_INSTALLMENTS) {
    formError = `An installment plan needs ${MIN_INSTALLMENTS} to ${MAX_INSTALLMENTS} installments (got ${list.length}).`;
  } else if (!(totalCents > 0)) {
    formError = 'The booking has no total amount yet, so it cannot be split into installments.';
  }

  let prev = null;
  list.forEach((r, i) => {
    const n = i + 1;
    const amountText = r.amount === '' || r.amount == null ? '' : String(r.amount);
    const amount = Number(amountText);
    if (!isValidYmd(r.due_date)) {
      rowErrors[i] = `Installment ${n} has an invalid due date.`;
    } else if (amountText === '' || !Number.isFinite(amount)) {
      rowErrors[i] = `Installment ${n} has an invalid amount.`;
    } else if (amount <= 0) {
      rowErrors[i] = `Installment ${n} must be more than ₱0.`;
    } else if (hasMoreThanTwoDecimals(amountText)) {
      rowErrors[i] = `Installment ${n} has more than two decimal places.`;
    } else if (prev && r.due_date <= prev) {
      rowErrors[i] = `Due dates must be in order with no two on the same day (installment ${n}).`;
    } else if (isNew && i === 0 && r.due_date < today) {
      rowErrors[i] = 'The first installment cannot be due before today.';
    }
    if (isValidYmd(r.due_date)) prev = r.due_date;
    if (Number.isFinite(amount)) sumCents += toCents(amount);
  });

  if (!formError && Object.keys(rowErrors).length === 0 && sumCents !== totalCents) {
    formError = `The installments add up to ${peso(sumCents)} but the booking total is ${peso(totalCents)}. They must match exactly.`;
  }

  return {
    ok: !formError && Object.keys(rowErrors).length === 0,
    rowErrors,
    formError,
    sum: sumCents / 100,
    difference: (totalCents - sumCents) / 100,
  };
}

/**
 * The event's Manila date when any installment falls after it, else null.
 * Allowed for suki customers (§9); the editor warns, it never blocks.
 */
export function dueAfterEventDate(rows, eventDatetime) {
  const eventDay = manilaYmd(eventDatetime);
  if (!eventDay) return null;
  return (rows || []).some(r => isValidYmd(r.due_date) && r.due_date > eventDay) ? eventDay : null;
}

/** The rows as the RPC expects them: plain date strings, amounts rounded to centavos. */
export const toRpcRows = (rows) => rows.map(r => ({
  due_date: r.due_date,
  amount: Math.round(Number(r.amount) * 100) / 100,
}));

/** Puts whatever the schedule is short (or over) onto the last row. */
export function putDifferenceOnLast(rows, total) {
  if (!rows?.length) return rows;
  const others = rows.slice(0, -1).reduce((s, r) => s + toCents(r.amount || 0), 0);
  const last = (toCents(total) - others) / 100;
  return [...rows.slice(0, -1), { ...rows[rows.length - 1], amount: last }];
}

export const INSTALLMENT_STATUS_PILL = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Partly paid': 'bg-sky-50 text-sky-700 border-sky-200',
  Due: 'bg-amber-50 text-amber-700 border-amber-200',
  Overdue: 'bg-red-50 text-red-700 border-red-200',
  Upcoming: 'bg-slate-50 text-slate-600 border-slate-200',
  Closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

/** "Oct 25" for a 'YYYY-MM-DD' (read as a calendar date, never shifted). */
export function shortYmd(ymd) {
  if (!isValidYmd(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Oct 25, 2026" for a 'YYYY-MM-DD'. */
export function longYmd(ymd) {
  if (!isValidYmd(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
