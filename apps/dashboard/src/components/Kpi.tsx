export function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="card flex flex-wrap">{children}</div>;
}

export interface KpiTrend { direction: "up" | "down" | "flat"; magnitude: number; unit: string; good: boolean }

export function Kpi({ label, value, suffix, trend, trendExtra, sparkline }: {
  label: string; value: string | number; suffix?: string; trend?: KpiTrend | null; trendExtra?: string; sparkline?: number[];
}) {
  const color = trend ? (trend.good ? "var(--chip-approved-fg)" : "var(--chip-rejected-fg)") : undefined;
  const arrow = trend?.direction === "up" ? "↗" : trend?.direction === "down" ? "↙" : "→";
  return (
    <div className="min-w-[150px] flex-1 border-b border-r border-line px-6 py-5 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-body text-[26px] font-semibold text-ink">
        {value}
        {suffix && <span className="ml-0.5 text-lg font-medium text-ink-2">{suffix}</span>}
      </div>
      {sparkline && sparkline.length > 1 && <Sparkline points={sparkline} />}
      {trend && (
        <div className="mt-1 text-xs text-ink-2">
          <span className="font-semibold" style={{ color }}>{arrow} {trend.magnitude}{trend.unit === "pts" ? " pts" : "%"}</span> vs 30d
          {trendExtra && <> · {trendExtra}</>}
        </div>
      )}
    </div>
  );
}

/** A minimal inline sparkline (Overview KPI cards): a plain polyline over up to 8 weekly points, with a small
 * dot marking the latest one, colored the same green/red as the trend text next to it. */
function Sparkline({ points }: { points: number[] }) {
  const w = 70, h = 20, pad = 2;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const range = Math.max(1, max - min);
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const last = points[points.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1.5" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--line)" strokeWidth="1.5" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="2.5" fill="var(--accent)" />
    </svg>
  );
}
