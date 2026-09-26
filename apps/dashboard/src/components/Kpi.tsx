export function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="card flex flex-wrap">{children}</div>;
}

export function Kpi({ label, value, suffix, trend }: { label: string; value: string | number; suffix?: string; trend?: string }) {
  return (
    <div className="min-w-[150px] flex-1 border-b border-r border-line px-6 py-5 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-body text-[26px] font-semibold text-ink">
        {value}
        {suffix && <span className="ml-0.5 text-lg font-medium text-ink-2">{suffix}</span>}
      </div>
      {trend && <div className="mt-1 text-xs text-ink-2">{trend}</div>}
    </div>
  );
}
