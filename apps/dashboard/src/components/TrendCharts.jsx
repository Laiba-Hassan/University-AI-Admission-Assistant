const W = 560,
  H = 160,
  PAD = 8;
function scale(values) {
  const max = Math.max(1, ...values);
  return v => H - PAD - v / max * (H - PAD * 2);
}
const fmtWeek = w => new Date(`${w}T00:00:00Z`).toLocaleDateString(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

/** A real line chart over the weekly conversation/lead counts the API computed -- no placeholder data. Each
 * series gets its own "LABEL ... value" header row (reference layout), and a soft area fill under its line. */
export function VolumeTrendChart({
  points
}) {
  if (points.length === 0) return <Empty />;
  // A single real data point has nowhere to draw a line TO -- "M x y" alone paints nothing. Rather than a lone
  // dot, treat it as a rise from 0 (the chart's left edge, before this tenant had any activity) up to today's
  // real value at the right edge: an honest "here's where we started, here's where we are" line, not fake data.
  const single = points.length === 1;
  const x = i => single ? PAD + i * (W - PAD * 2) : PAD + i / Math.max(1, points.length - 1) * (W - PAD * 2);
  const y = scale(points.flatMap(p => [p.conversations, p.leads]));
  const line = key => single
    ? `M ${x(0)} ${y(0)} L ${x(1)} ${y(points[0][key])}`
    : points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[key])}`).join(" ");
  const area = key => `${line(key)} L ${single ? x(1) : x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const total = key => points.reduce((s, p) => s + p[key], 0);
  return <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Conversations</span>
        <span className="font-heading text-lg font-semibold text-ink">{total("conversations").toLocaleString()}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Conversations and leads over time">
        <defs>
          <linearGradient id="volFillBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-blue)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--series-blue)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="volFillOrange" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-orange)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--series-orange)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area("conversations")} fill="url(#volFillBlue)" stroke="none" />
        <path d={area("leads")} fill="url(#volFillOrange)" stroke="none" />
        <path d={line("conversations")} fill="none" stroke="var(--series-blue)" strokeWidth="2" />
        <path d={line("leads")} fill="none" stroke="var(--series-orange)" strokeWidth="2" />
        {/* Marks today's real value at the end of the rise-from-zero line above, so it still reads as "the
           current point", not just where the line happens to stop. */}
        {single && <>
            <circle cx={x(1)} cy={y(points[0].conversations)} r="3" fill="var(--series-blue)" />
            <circle cx={x(1)} cy={y(points[0].leads)} r="3" fill="var(--series-orange)" />
          </>}
      </svg>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Leads captured</span>
        <span className="font-heading text-lg font-semibold text-ink">{total("leads").toLocaleString()}</span>
      </div>
      <WeekLabels points={points} />
    </div>;
}

/** Two categories only, matching the reference design: AI-resolved vs Escalated. A conversation escalates for
 * one of three reasons (conversations.handoff_source, migration 0020) and the API still reports them split, but
 * this chart combines all three into one "Escalated" segment -- simpler to read at a glance than four colors. */
const RESOLUTION_SERIES = [{
  key: "resolved",
  label: "AI-resolved",
  color: "var(--series-aqua)"
}, {
  key: "escalated",
  label: "Escalated",
  color: "var(--series-orange)",
  sourceKeys: ["escalated_ai", "escalated_student", "escalated_staff"]
}];
const valueOf = (p, s) => s.sourceKeys ? s.sourceKeys.reduce((sum, k) => sum + (p[k] ?? 0), 0) : (p[s.key] ?? 0);

/** Weekly resolution outcomes, stacked -- approximated from each conversation's CURRENT status (no separate
 * resolution-event history exists yet), so a conversation still 'open' counts as none of them. */
export function ResolutionChart({
  points
}) {
  if (points.length === 0) return <Empty />;
  const barW = Math.min(48, (W - PAD * 2) / points.length - 10);
  const stackOf = p => RESOLUTION_SERIES.reduce((s, k) => s + valueOf(p, k), 0);
  const max = Math.max(1, ...points.map(stackOf));
  const scaleH = v => v / max * (H - PAD * 2 - 16);
  return <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Conversation outcomes per week, split by who ended the conversation">
        {points.map((p, i) => {
        const cx = PAD + (i + 0.5) * ((W - PAD * 2) / points.length);
        const base = H - PAD;
        let offset = 0;
        const bars = RESOLUTION_SERIES.map(s => {
          const value = valueOf(p, s);
          if (value === 0) return null;
          const h = scaleH(value);
          const y = base - offset - h;
          offset += h;
          return <rect key={s.key} x={cx - barW / 2} y={y} width={barW} height={Math.max(h, 1)} fill={s.color} rx="2">
                <title>{`${s.label}: ${value}`}</title>
              </rect>;
        });
        return <g key={p.week}>
              <text x={cx} y={base - offset - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">
                {stackOf(p)}
              </text>
              {bars}
            </g>;
      })}
      </svg>
      <div className="flex justify-around text-[10px] text-muted">
        {points.map(p => <span key={p.week}>{fmtWeek(p.week)}</span>)}
      </div>
    </div>;
}

/** The dot legend, placed in the Resolution card's header (top-right, next to the title) rather than under the
 * chart, matching the reference. Always both entries, even at zero -- otherwise an early tenant with nothing
 * closed or escalated yet shows a legend that doesn't even name what the chart is tracking. */
export function ResolutionLegend() {
  return <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-ink-2">
      {RESOLUTION_SERIES.map(s => <LegendItem key={s.key} label={s.label} color={s.color} />)}
    </div>;
}
function LegendItem({
  label,
  color
}) {
  return <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{
      background: color
    }} />
      {label}
    </span>;
}
function WeekLabels({
  points
}) {
  const mid = points[Math.floor((points.length - 1) / 2)];
  return <div className="mt-1 flex justify-between text-[10px] text-muted">
      <span>{fmtWeek(points[0].week)}</span>
      {points.length > 2 && <span>{fmtWeek(mid.week)}</span>}
      {points.length > 1 && <span>{fmtWeek(points[points.length - 1].week)}</span>}
    </div>;
}
function Empty() {
  return <div className="flex h-40 items-center justify-center text-sm text-muted">No activity in this period yet.</div>;
}