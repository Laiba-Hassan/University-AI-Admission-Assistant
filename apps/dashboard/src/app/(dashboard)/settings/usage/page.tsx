"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";

interface Usage { monthly_conversation_limit: number; monthly_message_limit: number; web_enabled: boolean; whatsapp_enabled: boolean; conversations_used: number; messages_used: number }

export default function UsageTab() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { void apiJson<Usage>("/api/v1/settings/usage").then(setU); }, []);
  if (!u) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="max-w-md space-y-5">
      <Bar label="Conversations" used={u.conversations_used} limit={u.monthly_conversation_limit} />
      <Bar label="Messages" used={u.messages_used} limit={u.monthly_message_limit} />
      <div className="flex gap-6 pt-2 text-sm">
        <span className="text-ink-2">Web: <strong className="text-ink">{u.web_enabled ? "Enabled" : "Disabled"}</strong></span>
        <span className="text-ink-2">WhatsApp: <strong className="text-ink">{u.whatsapp_enabled ? "Enabled" : "Disabled"}</strong></span>
      </div>
    </div>
  );
}

function Bar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-2">
        <span>{label}</span>
        <span className="font-semibold text-ink">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
