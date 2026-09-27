"use client";
import { useEffect, useState } from "react";
import { PlatformHeader } from "@/components/PlatformHeader";
import { apiJson } from "@/lib/api";

interface Health { database: { ok: boolean; latency_ms: number }; queue_depth: number | null; error_tracking: { configured: boolean; note: string } }

export default function HealthPage() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => void apiJson<Health>("/api/platform/health").then(setH);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  if (!h) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <PlatformHeader title="Platform Health" />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusCard label="Database" ok={h.database.ok} detail={`${h.database.latency_ms}ms`} />
        <StatusCard label="Job queue" ok={h.queue_depth !== null} detail={h.queue_depth !== null ? `${h.queue_depth} jobs pending` : "unreachable"} />
        <StatusCard label="Error tracking" ok={h.error_tracking.configured} detail={h.error_tracking.configured ? "connected" : "not configured"} />
      </div>

      {!h.error_tracking.configured && (
        <div className="card p-5 text-sm text-ink-2">
          <strong className="text-ink">No error-tracking / APM integration is wired up yet.</strong>
          <p className="mt-1">{h.error_tracking.note} This page intentionally does not show uptime history, incident timelines, or error-rate charts, since this codebase has no real data source for them -- adding a Sentry (or equivalent) integration is what would populate that.</p>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ok ? "var(--chip-approved-fg)" : "var(--chip-rejected-fg)" }} />
      <div>
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
    </div>
  );
}
