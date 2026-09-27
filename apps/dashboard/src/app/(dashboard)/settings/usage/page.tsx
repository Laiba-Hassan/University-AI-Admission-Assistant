"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";

interface Usage {
  monthly_conversation_limit: number; monthly_message_limit: number; web_enabled: boolean; whatsapp_enabled: boolean;
  conversations_used: number; messages_used: number;
  by_channel: { web: { conversations: number; messages: number }; whatsapp: { conversations: number; messages: number } };
}

export default function UsageTab() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { void apiJson<Usage>("/api/v1/settings/usage").then(setU); }, []);
  if (!u) return <p className="text-sm text-muted">Loading…</p>;

  const resetDate = new Date();
  resetDate.setMonth(resetDate.getMonth() + 1, 1);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold text-ink">Monthly usage</h2>
        <span className="text-xs text-muted">Resets {resetDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <Channel label="Web" enabled={u.web_enabled} conversations={u.by_channel.web.conversations} messages={u.by_channel.web.messages} convLimit={u.monthly_conversation_limit} msgLimit={u.monthly_message_limit} />
        <Channel label="WhatsApp" enabled={u.whatsapp_enabled} conversations={u.by_channel.whatsapp.conversations} messages={u.by_channel.whatsapp.messages} convLimit={u.monthly_conversation_limit} msgLimit={u.monthly_message_limit} />
      </div>
    </div>
  );
}

function Channel({ label, enabled, conversations, messages, convLimit, msgLimit }: {
  label: string; enabled: boolean; conversations: number; messages: number; convLimit: number; msgLimit: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {label === "Web" ? <GlobeIcon /> : <ChatIcon />} {label}
        {!enabled && <span className="chip chip-neutral">Disabled</span>}
      </div>
      <div className="mt-3 space-y-4">
        <Bar label="Conversations" used={conversations} limit={convLimit} />
        <Bar label="Messages" used={messages} limit={msgLimit} />
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

function GlobeIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>; }
function ChatIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
