"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

export default function RetentionTab() {
  const [days, setDays] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { void apiJson<{ retention_days: number }>("/api/v1/settings/retention").then((r) => setDays(r.retention_days)); }, []);
  if (days === null) return <p className="text-sm text-muted">Loading…</p>;

  async function save() {
    await apiFetch("/api/v1/settings/retention", { method: "PATCH", body: JSON.stringify({ retention_days: days }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-sm">
      <label className="text-xs font-medium text-ink-2">Transcripts and leads are kept for</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        <span className="text-sm text-ink-2">days</span>
      </div>
      <p className="mt-2 text-xs text-muted">WhatsApp opt-outs are honored immediately and independent of this setting.</p>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Save</button>
        {saved && <span className="text-xs text-ink-2">Saved.</span>}
      </div>
    </div>
  );
}
