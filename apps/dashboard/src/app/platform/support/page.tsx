"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { dateStr, PlatformHeader } from "@/components/PlatformHeader";
import { apiFetch, apiJson } from "@/lib/api";

interface Note { id: string; note: string; status: "open" | "resolved"; created_by: string; created_at: string; tenant_id: string; tenant_name: string }

export default function SupportPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [notes, setNotes] = useState<Note[] | null>(null);

  async function load(s: "open" | "resolved") {
    setNotes(null);
    const res = await apiJson<{ notes: Note[] }>(`/api/platform/support-notes?status=${s}`);
    setNotes(res.notes);
  }
  useEffect(() => { void load(status); }, [status]);

  async function resolve(n: Note) {
    await apiFetch(`/api/platform/tenants/${n.tenant_id}/support-notes/${n.id}`, { method: "PATCH", body: JSON.stringify({ status: n.status === "open" ? "resolved" : "open" }) });
    await load(status);
  }

  return (
    <div>
      <PlatformHeader title="Tenant Support" />
      <p className="mb-4 text-sm text-ink-2">Read-only config viewer -- no impersonation. Support notes left on any tenant&apos;s detail page, across the whole platform.</p>
      <div className="mb-4 flex gap-1.5">
        {(["open", "resolved"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${status === s ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>{s}</button>
        ))}
      </div>
      <div className="card divide-y divide-line">
        {notes === null && <p className="p-5 text-sm text-muted">Loading…</p>}
        {notes !== null && notes.length === 0 && <p className="p-5 text-sm text-muted">No {status} notes.</p>}
        {notes?.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <Link href={`/platform/tenants/${n.tenant_id}`} className="text-sm font-semibold text-accent hover:underline">{n.tenant_name}</Link>
              <div className="text-sm text-ink">{n.note}</div>
              <div className="text-xs text-muted">{n.created_by} · {dateStr(n.created_at)}</div>
            </div>
            <button onClick={() => resolve(n)} className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${n.status === "open" ? "chip-draft" : "chip-approved"}`}>{n.status === "open" ? "Open" : "Resolved"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
