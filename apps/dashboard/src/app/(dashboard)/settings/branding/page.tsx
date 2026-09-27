"use client";
import { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/Modal";
import { apiFetch, apiJson } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface Branding { name: string; branding: { primary?: string; accent?: string; tagline?: string }; working_hours: { tz?: string; mon_fri?: string | null } }

export default function BrandingTab() {
  const [data, setData] = useState<Branding | null>(null);
  const [saved, setSaved] = useState(false);
  const theme = useTheme();
  useEffect(() => { void apiJson<Branding>("/api/v1/settings/branding").then(setData); }, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  async function save() {
    await apiFetch("/api/v1/settings/branding", { method: "PATCH", body: JSON.stringify({ branding: data!.branding }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  const accent = data.branding.accent || "#c15f3c";
  const welcome = data.branding.tagline || "Ask me about programs, fees, deadlines or scholarships.";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
      <div>
        <h2 className="font-heading text-lg font-semibold text-ink">Branding</h2>

        <div className="mt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Logo &amp; color</span>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent font-heading text-lg font-semibold text-accent">
              {(data.name || "?")[0]!.toUpperCase()}
            </span>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#c15f3c"}
              onChange={(e) => setData({ ...data, branding: { ...data.branding, accent: e.target.value } })}
              className="h-9 w-9 cursor-pointer rounded-lg border border-line p-0.5"
              aria-label="Accent color"
            />
            <input
              value={data.branding.accent ?? ""}
              onChange={(e) => setData({ ...data, branding: { ...data.branding, accent: e.target.value } })}
              placeholder="#C15F3C"
              className="w-28 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-2"
            />
          </div>
        </div>

        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Working hours</span>
          <p className="mt-1.5 text-sm text-ink">{data.working_hours.mon_fri ?? "Not set"} {data.working_hours.tz ? `(${data.working_hours.tz})` : ""}</p>
        </div>

        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Welcome message</span>
          <input
            value={data.branding.tagline ?? ""}
            onChange={(e) => setData({ ...data, branding: { ...data.branding, tagline: e.target.value } })}
            placeholder="Assalam-o-Alaikum! Ask me about programs, fees, deadlines or scholarships."
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Appearance</span>
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line px-3.5 py-2.5">
            <div>
              <div className="text-sm font-medium text-ink">Dashboard appearance</div>
              <div className="text-xs text-muted">Currently {theme.dark ? "Dark" : "Light"} · tap to switch to {theme.dark ? "Light" : "Dark"}</div>
            </div>
            <ToggleSwitch checked={theme.dark} onChange={theme.toggle} />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Save changes</button>
          {saved && <span className="text-xs text-ink-2">Saved.</span>}
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Live widget preview</span>
        <div className="mt-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold" style={{ borderColor: accent, color: accent }}>
              {(data.name || "?")[0]!.toUpperCase()}
            </span>
            <span className="text-sm font-semibold text-ink">{data.name} Admissions</span>
          </div>
          <div className="mt-2 rounded-lg bg-tint px-3 py-2 text-xs text-ink">{welcome}</div>
        </div>
      </div>
    </div>
  );
}
