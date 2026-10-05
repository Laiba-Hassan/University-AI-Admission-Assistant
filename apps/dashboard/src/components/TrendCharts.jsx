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
  const x = i => PAD + i / Math.max(1, points.length - 1) * (W - PAD * 2);
  const y = scale(points.flatMap(p => [p.conversations, p.leads]));
  const line = key => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[key])}`).join(" ");
  const area = key => `${line(key)} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
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
      </svg>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Leads captured</span>
        <span className="font-heading text-lg font-semibold text-ink">{total("leads").toLocaleString()}</span>
      </div>
      <WeekLabels points={points} />
    </div>;
}

/** The stack, bottom to top. Escalations are split by which of the three writers caused the handoff
 * (conversations.handoff_source, migration 0020): "the AI gave up" and "the student asked for a person" are
 * different signals -- the first points at a knowledge-base gap, the second is just a preference -- and one
 * combined Escalated bar hid which one a university actually had. A conversation escalated before that column
 * existed has no source recorded (API: trend[].escalated_unknown) -- deliberately left out of this chart rather
 * than shown as a standing "Unrecorded" slice, since it only ever shrinks as a share of activity over time and
 * isn't something a university can act on. The overview's own handoff-rate KPI is unaffected: it counts every
 * escalated conversation regardless of source, this chart just doesn't visualize that one slice. */
const RESOLUTION_SERIES = [{
  key: "resolved",
  label: "AI-resolved",
  color: "var(--series-aqua)"
}, {
  key: "escalated_ai",
  label: "AI handed off",
  color: "var(--series-orange)"
}, {
  key: "escalated_student",
  label: "Student asked",
  color: "var(--series-blue)"
}, {
  key: "escalated_staff",
  label: "Staff escalated",
  color: "var(--series-violet)"
}];
const seriesTotal = (points, key) => points.reduce((s, p) => s + (p[key] ?? 0), 0);

/** Weekly resolution outcomes, stacked -- approximated from each conversation's CURRENT status (no separate
 * resolution-event history exists yet), so a conversation still 'open' counts as none of them. */
export function ResolutionChart({
  points
}) {
  if (points.length === 0) return <Empty />;
  const barW = Math.min(48, (W - PAD * 2) / points.length - 10);
  const stackOf = p => RESOLUTION_SERIES.reduce((s, k) => s + (p[k.key] ?? 0), 0);
  const max = Math.max(1, ...points.map(stackOf));
  const scaleH = v => v / max * (H - PAD * 2 - 16);
  return <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Conversation outcomes per week, split by who ended the conversation">
        {points.map((p, i) => {
        const cx = PAD + (i + 0.5) * ((W - PAD * 2) / points.length);
        const base = H - PAD;
        let offset = 0;
        const bars = RESOLUTION_SERIES.map(s => {
          const value = p[s.key] ?? 0;
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
 * chart, matching the reference. "AI-resolved" is the chart's own namesake distinction (resolved vs escalated)
 * and always shows, even in a period with zero resolved conversations -- otherwise a week where the bot hasn't
 * closed anything yet would show an "Escalated"-only chart with no visible "Resolution" in it at all. The three
 * escalation-source entries are genuinely optional detail, so those stay conditional on actually occurring. */
export function ResolutionLegend({
  points = []
}) {
  const sources = RESOLUTION_SERIES.filter(s => s.key !== "resolved" && seriesTotal(points, s.key) > 0);
  const list = [RESOLUTION_SERIES[0], ...sources];
  return <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-ink-2">
      {list.map(s => <LegendItem key={s.key} label={s.label} color={s.color} />)}
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