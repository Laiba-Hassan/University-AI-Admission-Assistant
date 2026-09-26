export interface TrendPoint { week: string; conversations: number; leads: number; resolved: number; escalated: number }

const W = 560, H = 160, PAD = 8;

function scale(values: number[]) {
  const max = Math.max(1, ...values);
  return (v: number) => H - PAD - (v / max) * (H - PAD * 2);
}

/** A real line chart over the weekly conversation/lead counts the API computed -- no placeholder data. */
export function VolumeTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <Empty />;
  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = scale(points.flatMap((p) => [p.conversations, p.leads]));
  const path = (key: "conversations" | "leads") => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[key])}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Conversations and leads over time">
        <path d={path("conversations")} fill="none" stroke="var(--series-blue)" strokeWidth="2" />
        <path d={path("leads")} fill="none" stroke="var(--series-orange)" strokeWidth="2" />
      </svg>
      <Legend items={[["Conversations", "var(--series-blue)"], ["Leads captured", "var(--series-orange)"]]} />
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
              <rect x={cx - barW / 2} y={base - resolvedH} width={barW} height={resolvedH} fill="var(--series-aqua)" rx="2" />
              <rect x={cx - barW / 2} y={base - resolvedH - escalatedH} width={barW} height={escalatedH} fill="var(--series-orange)" rx="2" />
            </g>
          );
        })}
      </svg>
      <Legend items={[["AI-resolved", "var(--series-aqua)"], ["Escalated", "var(--series-orange)"]]} />
      <WeekLabels points={points} />
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex gap-4 text-xs text-ink-2">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
function WeekLabels({ points }: { points: TrendPoint[] }) {
  return (
    <div className="mt-1 flex justify-between text-[10px] text-muted">
      <span>{points[0]!.week}</span>
      {points.length > 1 && <span>{points[points.length - 1]!.week}</span>}
    </div>
  );
}
function Empty() { return <div className="flex h-40 items-center justify-center text-sm text-muted">No activity in this period yet.</div>; }
