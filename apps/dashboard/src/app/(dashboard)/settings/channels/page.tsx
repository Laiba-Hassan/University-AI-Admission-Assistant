"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { StatusChip } from "@/components/StatusChip";

interface Channels {
  web_widget: { public_key: string; allowed_origins: string[]; status: string } | null;
  whatsapp: { phone_number_id: string; display_number: string | null; template_status: string | null; status: string; connected_at: string | null } | null;
}

export default function ChannelsTab() {
  const [data, setData] = useState<Channels | null>(null);
  useEffect(() => { void apiJson<Channels>("/api/v1/settings/channels").then(setData).catch(() => setData({ web_widget: null, whatsapp: null })); }, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="divide-y divide-line">
      <div className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">🌐 Web widget</div>
            {data.web_widget ? (
              <div className="text-xs text-ink-2">Allowed origins: {data.web_widget.allowed_origins.join(", ") || "none set"}</div>
            ) : <div className="text-xs text-muted">Not set up yet.</div>}
          </div>
          {data.web_widget && <StatusChip status={data.web_widget.status === "active" ? "closed" : "open"} />}
        </div>
      </div>
      <div className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">💬 WhatsApp</div>
            {data.whatsapp ? (
              <div className="text-xs text-ink-2">{data.whatsapp.display_number ?? data.whatsapp.phone_number_id} · template: {data.whatsapp.template_status ?? "—"}</div>
            ) : <div className="text-xs text-muted">Not connected yet.</div>}
          </div>
          {data.whatsapp && <StatusChip status={data.whatsapp.status === "active" ? "closed" : "open"} />}
        </div>
      </div>
    </div>
  );
}
