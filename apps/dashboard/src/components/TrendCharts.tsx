export interface TrendPoint { week: string; conversations: number; leads: number; resolved: number; escalated: number }

const W = 560, H = 160, PAD = 8;

function scale(values: number[]) {
  const max = Math.max(1, ...values);
  return (v: number) => H - PAD - (v / max) * (H - PAD * 2);
}

const fmtWeek = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** A real line chart over the weekly conversation/lead counts the API computed -- no placeholder data. Each
 * series gets its own "LABEL ... value" header row (reference layout), and a soft area fill under its line. */
export function VolumeTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <Empty />;
  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = scale(points.flatMap((p) => [p.conversations, p.leads]));
  const line = (key: "conversations" | "leads") => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[key])}`).join(" ");
  const area = (key: "conversations" | "leads") => `${line(key)} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const total = (key: "conversations" | "leads") => points.reduce((s, p) => s + p[key], 0);

  return (
    <div>
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
    </div>
  );
}

/** Weekly AI-resolved vs escalated conversations, stacked -- approximated from each conversation's CURRENT
 * status (no separate resolution-event history exists yet), so a conversation still 'open' counts as neither. */
export function ResolutionChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <Empty />;
  const barW = Math.min(48, (W - PAD * 2) / points.length - 10);
  const max = Math.max(1, ...points.map((p) => p.resolved + p.escalated));
  const scaleH = (v: number) => (v / max) * (H - PAD * 2 - 16);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="AI-resolved vs escalated conversations per week">
        {points.map((p, i) => {
          const cx = PAD + (i + 0.5) * ((W - PAD * 2) / points.length);
          const resolvedH = scaleH(p.resolved), escalatedH = scaleH(p.escalated);
          const base = H - PAD;
          return (
            <g key={p.week}>
              <text x={cx} y={base - resolvedH - escalatedH - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">
                {p.resolved + p.escalated}
              </text>
              <rect x={cx - barW / 2} y={base - resolvedH} width={barW} height={Math.max(resolvedH, 1)} fill="var(--series-aqua)" rx="2" />
              <rect x={cx - barW / 2} y={base - resolvedH - escalatedH} width={barW} height={escalatedH} fill="var(--series-orange)" rx="2" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-around text-[10px] text-muted">
        {points.map((p) => <span key={p.week}>{fmtWeek(p.week)}</span>)}
      </div>
    </div>
  );
}

/** The "AI-resolved"/"Escalated" dot legend, placed in the Resolution card's header (top-right, next to the
 * title), matching the reference -- not under the chart. */
export function ResolutionLegend() {
  return (
    <div className="flex gap-4 text-xs text-ink-2">
      <LegendItem label="AI-resolved" color="var(--series-aqua)" />
      <LegendItem label="Escalated" color="var(--series-orange)" />
    </div>
  );
}
function LegendItem({ label, color }: { label: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function WeekLabels({ points }: { points: TrendPoint[] }) {
  const mid = points[Math.floor((points.length - 1) / 2)];
  return (
    <div className="mt-1 flex justify-between text-[10px] text-muted">
      <span>{fmtWeek(points[0]!.week)}</span>
      {points.length > 2 && <span>{fmtWeek(mid!.week)}</span>}
      {points.length > 1 && <span>{fmtWeek(points[points.length - 1]!.week)}</span>}
    </div>
  );
}
function Empty() { return <div className="flex h-40 items-center justify-center text-sm text-muted">No activity in this period yet.</div>; }
