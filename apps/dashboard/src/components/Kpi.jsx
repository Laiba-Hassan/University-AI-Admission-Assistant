export function KpiStrip({
  children
}) {
  return <div className="card flex flex-wrap">{children}</div>;
}
export function Kpi({
  label,
  value,
  suffix,
  trend,
  trendExtra
}) {
  const color = trend ? trend.good ? "var(--chip-approved-fg)" : "var(--chip-rejected-fg)" : undefined;
  const arrow = trend?.direction === "up" ? "↗" : trend?.direction === "down" ? "↙" : "→";
  return <div className="min-w-[150px] flex-1 border-b border-r border-line px-6 py-5 text-center last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-body text-[26px] font-semibold text-ink">
        {value}
        {suffix && <span className="ml-0.5 text-lg font-medium text-ink-2">{suffix}</span>}
      </div>
      {trend && <div className="mt-1 text-xs text-ink-2">
          <span className="font-semibold" style={{
        color
      }}><span className="mr-1">{arrow}</span>{trend.magnitude}{trend.unit === "pts" ? " pts" : "%"}</span> vs previous period
          {trendExtra && <> · {trendExtra}</>}
        </div>}
    </div>;
}