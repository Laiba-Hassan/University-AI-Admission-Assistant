// tenants.working_hours shape (see data/*/tenant.json): { tz, mon_fri: "09:00-17:00" | null, sat: "..."|null, sun: "..."|null }
export interface WorkingHours { tz?: string; mon_fri?: string | null; sat?: string | null; sun?: string | null }

/** Best-effort "is the office open right now, in the tenant's own timezone" check, using only Intl (no library). */
export function isWithinWorkingHours(hours: WorkingHours | undefined, now = new Date()): boolean | undefined {
  if (!hours?.tz) return undefined; // unknown: caller should not show a banner either way
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: hours.tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  } catch {
    return undefined; // unrecognised timezone string
  }
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!weekday || Number.isNaN(hour) || Number.isNaN(minute)) return undefined;

  const range = weekday === "Sat" ? hours.sat : weekday === "Sun" ? hours.sun : hours.mon_fri;
  if (!range) return false; // explicitly closed that day
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range);
  if (!m) return undefined;
  const nowMinutes = hour * 60 + minute;
  const start = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]);
  return nowMinutes >= start && nowMinutes < end;
}
