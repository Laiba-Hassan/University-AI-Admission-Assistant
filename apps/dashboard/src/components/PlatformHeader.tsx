export function PlatformHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Enrollium Platform</div>
        <h1 className="mt-1 font-heading text-[26px] font-semibold text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}

export const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
export const dateStr = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
