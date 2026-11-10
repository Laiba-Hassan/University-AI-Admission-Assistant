import { useRef, useState } from "react";
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

/** Native SVG <title> tooltips always carry the browser's own ~1s hover delay -- fixed OS/browser behavior, not
 * something CSS or a prop can shorten. This renders instantly on mouseenter, tracks the cursor, and disappears
 * on mouseleave. One tooltip div per chart, shared by every hoverable element inside it. */
function useTooltip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null); // { text, x, y } in container-local pixels, or null
  const show = (text, e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ text, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const hide = () => setTip(null);
  return { ref, tip, show, hide };
}
function TooltipLayer({ tip }) {
  if (!tip) return null;
  return <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink shadow-md"
    style={{ left: tip.x, top: tip.y - 8 }}>
      {tip.text}
    </div>;
}

/** A real line chart over the weekly conversation/lead counts the API computed -- no placeholder data. Each
 * series gets its own "LABEL ... value" header row (reference layout), and a soft area fill under its line. */
export function VolumeTrendChart({
  points
}) {
  const { ref, tip, show, hide } = useTooltip();
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
  return <div ref={ref} className="relative">
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
        {/* A hoverable marker at every real data point for both series: a small visible dot plus a larger
           invisible hit-circle (easier to land the cursor on). For a single point, this also marks today's
           real value at the line's end. */}
        {(single ? [points[0]] : points).map((p, idx) => {
        const i = single ? 1 : idx;
        const weekLabel = fmtWeek(p.week);
        return <g key={p.week}>
              <circle cx={x(i)} cy={y(p.conversations)} r="8" fill="transparent" className="cursor-pointer"
                onMouseEnter={e => show(`${weekLabel} — Conversations: ${p.conversations}`, e)}
                onMouseMove={e => show(`${weekLabel} — Conversations: ${p.conversations}`, e)}
                onMouseLeave={hide} />
              <circle cx={x(i)} cy={y(p.conversations)} r="3" fill="var(--series-blue)" />
              <circle cx={x(i)} cy={y(p.leads)} r="8" fill="transparent" className="cursor-pointer"
                onMouseEnter={e => show(`${weekLabel} — Leads captured: ${p.leads}`, e)}
                onMouseMove={e => show(`${weekLabel} — Leads captured: ${p.leads}`, e)}
                onMouseLeave={hide} />
              <circle cx={x(i)} cy={y(p.leads)} r="3" fill="var(--series-orange)" />
            </g>;
      })}
      </svg>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Leads captured</span>
        <span className="font-heading text-lg font-semibold text-ink">{total("leads").toLocaleString()}</span>
      </div>
      <WeekLabels points={points} />
      <TooltipLayer tip={tip} />
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
  const { ref, tip, show, hide } = useTooltip();
  if (points.length === 0) return <Empty />;
  const barW = Math.min(48, (W - PAD * 2) / points.length - 10);
  const stackOf = p => RESOLUTION_SERIES.reduce((s, k) => s + valueOf(p, k), 0);
  const max = Math.max(1, ...points.map(stackOf));
  const scaleH = v => v / max * (H - PAD * 2 - 16);
  return <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Conversation outcomes per week, split by who ended the conversation">
        {points.map((p, i) => {
        const cx = PAD + (i + 0.5) * ((W - PAD * 2) / points.length);
        const base = H - PAD;
        const weekLabel = fmtWeek(p.week);
        let offset = 0;
        const bars = RESOLUTION_SERIES.map(s => {
          const value = valueOf(p, s);
          if (value === 0) return null;
          const h = scaleH(value);
          const y = base - offset - h;
          offset += h;
          const text = `${weekLabel} — ${s.label}: ${value}`;
          return <rect key={s.key} x={cx - barW / 2} y={y} width={barW} height={Math.max(h, 1)} fill={s.color} rx="2"
            onMouseEnter={e => show(text, e)} onMouseMove={e => show(text, e)} onMouseLeave={hide} />;
        });
        const totalText = `${weekLabel} — Total: ${stackOf(p)} (AI-resolved: ${valueOf(p, RESOLUTION_SERIES[0])}, Escalated: ${valueOf(p, RESOLUTION_SERIES[1])})`;
        return <g key={p.week} className="cursor-pointer">
              {/* A full-height invisible hit area behind the stack, so hovering anywhere in the column (not just
                 exactly on a thin segment) shows the week's total breakdown. */}
              <rect x={cx - barW / 2} y={PAD} width={barW} height={H - PAD * 2} fill="transparent"
                onMouseEnter={e => show(totalText, e)} onMouseMove={e => show(totalText, e)} onMouseLeave={hide} />
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
      <TooltipLayer tip={tip} />
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
