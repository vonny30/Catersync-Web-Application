// src/pages/Reports/EquipmentUtilizationTab.jsx
//
// Rendered as the "Equipment Stock" tab. The filename is kept — it is imported
// by name and renaming it is churn — but the tab no longer reports a rate.
//
// WHY THERE IS NO UTILIZATION PERCENTAGE HERE
//
// There was one, at two levels, and it was not merely unhelpful but wrong in a
// way no adjustment to the formula could fix:
//
//     committed / usable      (fleet-wide and per item)
//
// has no time dimension. `committed` sums every unreturned commitment across
// dates that never coexist, then divides by stock that is only owned once. An
// item booked for three separate days is counted three times against a single
// day's stock. Measured against live data the error grows with how many days
// an item spans — Chafing Dishes read 93% when its busiest single day used 41%,
// and earlier in this project it read 133%. The per-item bar was clamped with
// Math.min(100, ...), which is the code quietly knowing the value could exceed
// a hundred and hiding it instead of fixing it.
//
// A real utilization rate needs a bounded period and a per-day peak. The
// Vehicle Utilization tab does exactly that — dispatched vehicle-hours over
// available vehicle-hours in a fixed range, and it refuses to compute over All
// Time — so the contrast between the two tabs is deliberate: one measures a
// rate, and this one reports stock.
import { AlertTriangle, CheckCircle2, CalendarClock, Undo2 } from 'lucide-react';
import { cardColorClasses, cardAccentClass } from './helpers';

const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
// "about 2 days late" reads better than "46 h late" once it is past a day.
const fmtLate = (h) => (h >= 36 ? `about ${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);
const itemList = (items) => items.map(i => `${i.quantity} ${i.name}`).join(', ');

function Panel({ icon: Icon, title, scope, tone = 'slate', children }) {
  const iconTone = tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-[#008A45]' : 'text-slate-500';
  return (
    <section className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
      <header className="px-5 pt-4 pb-3 border-b border-slate-100">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Icon size={17} className={iconTone} /> {title}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">{scope}</p>
      </header>
      <div className="px-5 py-3.5">{children}</div>
    </section>
  );
}

// One problem, one line: what it is, which booking, what to do.
function Issue({ tone, label, detail, children }) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60';
  const ink = tone === 'red' ? 'text-red-800' : 'text-amber-800';
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${cls}`}>
      <p className={`text-[13.5px] font-semibold ${ink}`}>{label}</p>
      {detail && <p className="text-[12.5px] text-slate-600 mt-0.5">{detail}</p>}
      {children}
    </div>
  );
}

// `periodLabel` is the Reports filter in words — "this month", "all time".
// Committed and available follow it; stock does not. Every figure that follows
// the filter says so, because a figure that silently ignores or silently obeys
// a control sitting above it is exactly how "Available Now" came to mean
// something different from what the filter implied.
export default function EquipmentUtilizationTab({ derived, onOpenDetail, periodLabel = 'the selected period' }) {
  const { equipmentUtilizationData, equipmentHealth } = derived;
  const health = equipmentHealth || { overdue: [], outOnCancelled: [], returnedWithoutTime: [], tight: [], returns: { bookings: 0 }, horizonDays: 60 };
  const followUpCount = health.overdue.length + health.outOnCancelled.length + health.returnedWithoutTime.length;
  // "Events in all time" is not English. The period reads as a phrase that
  // fits after "events", whichever preset is chosen.
  const inPeriod = periodLabel === 'all time' ? 'at any time' : `in ${periodLabel}`;

  const totalDeployed = equipmentUtilizationData.reduce((sum, e) => sum + e.deployed, 0);
  const totalUsable = equipmentUtilizationData.reduce((sum, e) => sum + e.usable, 0);
  const totalFree = equipmentUtilizationData.reduce((sum, e) => sum + e.free, 0);
  const totalDamaged = equipmentUtilizationData.reduce((sum, e) => sum + e.damaged, 0);
  const totalMaintenance = equipmentUtilizationData.reduce((sum, e) => sum + e.maintenance, 0);

  return (
    <div className="space-y-[18px]">
      {/* ORDER IS URGENCY. A manager opening this tab needs, first, anything
          that has to be chased today; then anything that will run short; then
          whether the return process is working; and only then the stock levels
          that used to be all this tab showed. Stock levels answer "what do I
          have". These answer "is it being looked after". */}
      <Panel
        icon={followUpCount ? AlertTriangle : CheckCircle2}
        tone={followUpCount ? 'amber' : 'green'}
        title="Needs follow-up"
        scope="As of now — not affected by the period filter."
      >
        <div className="space-y-2">
          {/* Always stated, clean or not. "Nothing is overdue" is the single
              clearest sign equipment is being managed well, so its absence is
              reported rather than left to be inferred from an empty space. */}
          {health.overdue.length === 0 ? (
            <p className="flex items-center gap-2 text-[13.5px] text-slate-700">
              <CheckCircle2 size={15} className="text-[#008A45] shrink-0" />
              Nothing is past its return deadline ({health.returns?.dueWithinHours ?? 24} hours after the event).
            </p>
          ) : health.overdue.map(g => (
            <Issue
              key={g.ref}
              tone="red"
              label={`${g.ref} — ${g.units} units overdue, ${fmtLate(g.hoursLate)} late`}
              detail={`${itemList(g.items)}. Event ${g.eventAt ? fmtDay(g.eventAt) : 'date unknown'}; due back within 24 hours of it.`}
            />
          ))}

          {/* Recorded as out on a booking that was called off. Either it never
              left and the record was never closed, or it did and has not come
              back — the page cannot tell which, so it asks. */}
          {health.outOnCancelled.map(g => (
            <Issue
              key={`c-${g.ref}`}
              tone="amber"
              label={`${g.ref} is ${g.status?.toLowerCase() || 'cancelled'} but ${g.units} units are still recorded as out`}
              detail={`${itemList(g.items)}. Confirm whether this gear ever left, then mark it returned so it stops holding stock on paper.`}
            />
          ))}

          {health.returnedWithoutTime.map(g => (
            <Issue
              key={`t-${g.ref}`}
              tone="amber"
              label={`${g.ref} was marked returned with no return time`}
              detail={`${g.units} units. Without a time it cannot be judged on time or late, so it is left out of the returns figures below.`}
            />
          ))}
        </div>
      </Panel>

      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <Panel
          icon={CalendarClock}
          tone={health.tight.length ? 'amber' : 'green'}
          title="Coming up tight"
          scope={`Next ${health.horizonDays} days from today — not affected by the period filter.`}
        >
          {health.tight.length === 0 ? (
            <p className="flex items-center gap-2 text-[13.5px] text-slate-700">
              <CheckCircle2 size={15} className="text-[#008A45] shrink-0" />
              No item is close to running out on any day in the next {health.horizonDays} days.
            </p>
          ) : (
            <ul className="space-y-2">
              {health.tight.map(t => (
                <li key={`${t.equipmentId}-${t.day.getTime()}`}>
                  <Issue
                    tone={t.spare < 0 ? 'red' : 'amber'}
                    label={`${t.name} — ${fmtDay(t.day)}: ${t.committed} of ${t.usable} usable booked, ${t.spare < 0 ? `${Math.abs(t.spare)} SHORT` : `${t.spare} spare`}`}
                    detail={`${t.refs.length ? `For ${t.refs.join(', ')}. ` : ''}${t.outOfService > 0
                      ? `${t.outOfService} of the ${t.owned} owned are out of service — repairing any would add spare.`
                      : 'None are out of service, so more stock is the only way to add spare.'}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={Undo2}
          tone={health.returns.late ? 'amber' : 'slate'}
          title="Returns"
          scope={`Events ${inPeriod}. Due back within ${health.returns.dueWithinHours ?? 24} hours of the event.`}
        >
          {/* THREE states, not two. Testing only bookings === 0 rendered
              "0 of 0 back on time" as a headline when a return existed but none
              had a time — a big figure that measured nothing. Nothing came back,
              something came back untimed, and something came back timed are
              different facts and each gets its own sentence. */}
          {health.returns.bookings === 0 ? (
            <p className="text-[13.5px] text-slate-600">No equipment came back from events {inPeriod}.</p>
          ) : health.returns.timed === 0 ? (
            <p className="text-[13.5px] text-slate-600">
              {health.returns.bookings} return{health.returns.bookings === 1 ? '' : 's'} from events {inPeriod}, but none has a recorded return time — so on-time returns cannot be measured for this period.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-slate-900">
                {health.returns.onTime} of {health.returns.timed} <span className="text-[14px] font-medium text-slate-600">back on time</span>
              </p>
              {health.returns.medianHours !== null && (
                <p className="text-[13px] text-slate-600">
                  Typically back {Math.round(health.returns.medianHours)} hours after the event
                  {health.returns.medianHours > (health.returns.dueWithinHours ?? 24) * 0.75 && ' — close to the deadline'}.
                </p>
              )}
              {health.returns.late > 0 && (
                <p className="text-[13px] font-semibold text-amber-700">{health.returns.late} came back late.</p>
              )}
              {health.returns.withoutTime > 0 && (
                <p className="text-[12.5px] text-slate-500">{health.returns.withoutTime} more marked returned with no time, so not counted.</p>
              )}
              {/* A rate from two bookings is a very different claim from one
                  built on fifty, and the reader cannot see which it is. */}
              <p className="text-[12px] text-slate-400">Based on {health.returns.timed} booking{health.returns.timed === 1 ? '' : 's'} with a recorded return time.</p>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        {/* Was "Available Now", which read as a live count while the page
            above it was filtered to a month — and it was neither: it summed
            every commitment on any date. It is now the stock left on each
            item's busiest day in the period, which is the number that decides
            whether that period can be served. */}
        <button
          onClick={() => onOpenDetail({
            title: 'Available on the Busiest Day',
            description: `For ${periodLabel}: each item's usable stock minus the units committed on its single busiest day in that period. Stock is owned once, so a Saturday booking and a Sunday booking do not add together — only the busiest day can run it short. Items peak on different days, so this total is a worst-case sum across items, not one day's figure.`,
            fields: [
              { label: 'Available on the busiest day', value: totalFree, emphasis: true },
              { label: 'Usable stock (today)', value: totalUsable },
              { label: 'Committed on the busiest day', value: totalDeployed },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('teal')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Available on the busiest day</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalFree}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">{periodLabel === 'all time' ? 'All time' : `For ${periodLabel}`} · {totalUsable} usable − {totalDeployed} committed</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Damaged Equipment',
            description: 'From the equipment table: units flagged as damaged (equipment.damaged_quantity), unavailable until repaired or replaced.',
            badge: totalDamaged > 0 ? { label: 'Needs attention', variant: 'warning' } : { label: 'None reported', variant: 'good' },
            fields: [{ label: 'Damaged units', value: totalDamaged, emphasis: true }],
          })}
          className="relative overflow-hidden border border-[#f3d3d3] bg-[#fef4f4] rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]"
        >
          <span className={cardAccentClass('red')} />
          <p className="text-[13px] font-semibold text-red-700 mb-2">Damaged</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-red-700">{totalDamaged}</h3>
          <p className="text-[13px] text-red-600 mt-2.5">Flagged, unavailable for booking</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Equipment In Maintenance',
            description: 'From the equipment table: units currently set aside for maintenance (equipment.maintenance_quantity).',
            fields: [{ label: 'In maintenance', value: totalMaintenance, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('amber')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">In Maintenance</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalMaintenance}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">Temporarily out of rotation</p>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Equipment by Type</h3>
          {/* Two scopes in one table, so both are stated. The old line said the
              whole table ignored the date range — true of the stock columns and
              false of what a manager actually reads it for. */}
          <p className="text-xs text-slate-500 mt-1">
            Owned, out of service and usable are the stock as it stands today. Committed and available follow the period above ({periodLabel}): committed is the most units booked on any single day in that period, and available is what is left on that day. Owned − out of service = usable; usable − committed = available.
          </p>
        </div>
        {equipmentUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No equipment data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Equipment</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Owned</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Out of service</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Usable</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">
                    Committed
                    <span className="block text-[11px] font-medium normal-case tracking-normal text-slate-500">busiest day</span>
                  </th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">
                    Available
                    <span className="block text-[11px] font-medium normal-case tracking-normal text-slate-500">on that day</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {equipmentUtilizationData.map((item) => {
                  // The badge that sat here — "Near capacity" at a usageRate of
                  // 80 or more — was built on the same timeless ratio, so it was
                  // not just imprecise but wrong: Chafing Dishes read "Near
                  // capacity" at 93% while its busiest day used 41%. It goes
                  // with the rate rather than being rebuilt on a guess.
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onOpenDetail({
                        title: item.name,
                        description: `For ${periodLabel}. Stock is from the equipment table as it stands today. Committed is the most units of this item booked on any single day in that period (booking_equipment, not yet returned, on Approved or Confirmed bookings), and available is what is left on that day.`,
                        fields: [
                          { label: 'Committed on the busiest day', value: item.deployed, emphasis: true },
                          { label: 'Available on that day', value: item.free },
                          { label: 'Days booked in the period', value: item.bookedDays },
                          { label: 'Usable', value: item.usable },
                          { label: 'Damaged', value: item.damaged },
                          { label: 'Under maintenance', value: item.maintenance },
                          { label: 'Units owned', value: item.total },
                        ],
                      })}
                      className="hover:bg-[#fbfcfd] cursor-pointer"
                    >
                      <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900">{item.name}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.total}</td>
                      <td className="px-5 py-[15px] text-sm text-right tabular-nums">
                        {item.outOfService > 0
                          ? <span className="text-amber-700 font-medium" title={`${item.damaged} damaged, ${item.maintenance} under maintenance`}>−{item.outOfService}</span>
                          : <span className="text-slate-400">None</span>}
                      </td>
                      <td className="px-5 py-[15px] text-sm font-semibold text-slate-900 text-right tabular-nums">{item.usable}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.deployed}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.free}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
