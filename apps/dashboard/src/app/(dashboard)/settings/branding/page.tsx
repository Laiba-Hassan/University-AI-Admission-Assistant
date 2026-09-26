"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Branding { name: string; branding: { primary?: string; accent?: string; tagline?: string }; working_hours: { tz?: string; mon_fri?: string | null } }

export default function BrandingTab() {
  const [data, setData] = useState<Branding | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { void apiJson<Branding>("/api/v1/settings/branding").then(setData); }, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  async function save() {
    await apiFetch("/api/v1/settings/branding", { method: "PATCH", body: JSON.stringify({ branding: data!.branding }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <label className="text-xs font-medium text-ink-2">Primary color</label>
        <input
          value={data.branding.primary ?? ""}
          onChange={(e) => setData({ ...data, branding: { ...data.branding, primary: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-2">Accent color</label>
        <input
          value={data.branding.accent ?? ""}
          onChange={(e) => setData({ ...data, branding: { ...data.branding, accent: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-2">Tagline</label>
        <input
          value={data.branding.tagline ?? ""}
          onChange={(e) => setData({ ...data, branding: { ...data.branding, tagline: e.target.value } })}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-ink-2">Working hours (Mon-Fri)</label>
        <p className="text-xs text-muted">{data.working_hours.mon_fri ?? "Not set"} {data.working_hours.tz ? `(${data.working_hours.tz})` : ""}</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Save changes</button>
        {saved && <span className="text-xs text-ink-2">Saved.</span>}
      </div>
    </div>
  );
}
