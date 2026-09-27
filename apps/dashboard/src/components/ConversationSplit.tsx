"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { StatusChip } from "./StatusChip";

export interface ConversationRow {
  id: string; channel: string; status: string; display_id: string | null;
  last_message: string | null; language: string | null; handoff_reason: string | null; assigned_email: string | null;
  has_lead: boolean; thumbs_down: boolean; last_message_at: string;
}
interface FactCard { type: "fee" | "intake"; label: string; value: string; as_of: string | null; stale?: boolean }
interface Message {
  id: string; role: string; content: string; detected_language: string | null; timestamp: string;
  metadata: { verifier?: { ok: boolean; unsupported: string[]; leak_blocked: boolean }; tool_calls?: { name: string; args: Record<string, unknown>; status: unknown }[]; cards?: FactCard[] };
  delivery_status: string | null; rating: number | null;
}
interface Detail {
  id: string; status: string; display_id: string | null; channel: string; language: string | null;
  handoff_reason: string | null; assigned_email: string | null; started_at: string; messages: Message[];
}

/** The list+detail split both Conversations and Inbox use, differing only in which query params they pass in
 * and which action buttons they render. */
export function ConversationSplit({ queryString, emptyLabel, renderActions, allowReply, showHandoffReason }: {
  queryString: string; emptyLabel: string; renderActions?: (d: Detail, refresh: () => void) => React.ReactNode; allowReply?: boolean; showHandoffReason?: boolean;
}) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const loadList = () => apiJson<{ data: ConversationRow[] }>(`/api/v1/conversations${queryString}`).then((r) => {
    setRows(r.data);
    setSelected((cur) => (cur && r.data.some((x) => x.id === cur) ? cur : r.data[0]?.id ?? null));
  }).catch(() => setRows([]));

  useEffect(() => { void loadList(); }, [queryString]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    apiJson<Detail>(`/api/v1/conversations/${selected}/messages`).then((d) => { if (!cancelled) setDetail(d); }).catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selected]);

  const refresh = () => { void loadList(); if (selected) apiJson<Detail>(`/api/v1/conversations/${selected}/messages`).then(setDetail).catch(() => {}); };

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/api/v1/conversations/${selected}/reply`, { method: "POST", body: JSON.stringify({ text: reply.trim() }) });
      setReply("");
      refresh();
    } finally {
      setSending(false);
    }
  }

  if (rows === null) return <p className="text-sm text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="card p-6 text-sm text-muted">{emptyLabel}</p>;

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      {showHandoffReason && (
        <p className="col-span-full -mb-2 text-xs text-ink-2">Reassigning a claimed conversation needs Admin or Editor.</p>
      )}
      <div className="card divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`block w-full px-4 py-3 text-left ${selected === r.id ? "bg-tint" : "hover:bg-tint/50"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <ChannelIcon channel={r.channel} />
                <span className="truncate text-sm font-medium text-ink">{r.display_id ?? "Unknown"}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted">{showHandoffReason ? `waiting ${relativeTime(r.last_message_at)}` : `${relativeTime(r.last_message_at)} ago`}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-2">{r.last_message ?? " "}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {showHandoffReason && r.handoff_reason && <span className="chip chip-rejected">{r.handoff_reason}</span>}
              {!showHandoffReason && <StatusChip status={r.status} />}
              {r.language && <span className="chip chip-neutral">{r.language}</span>}
              {r.thumbs_down && <span className="chip chip-rejected">👎</span>}
            </div>
            {showHandoffReason && (
              <p className="mt-1 text-[11px] text-ink-2">
                {r.assigned_email ? <>Assigned: {r.assigned_email}</> : "Unassigned"}
              </p>
            )}
          </button>
        ))}
      </div>

      <div className="card flex min-h-[420px] flex-col p-5">
        {!detail && <p className="text-sm text-muted">Select a conversation.</p>}
        {detail && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <div className="text-sm font-semibold text-ink">{detail.display_id}</div>
                <div className="text-xs text-muted">
                  {channelLabel(detail.channel)}
                  {detail.language && <> · {detail.language}</>}
                  {detail.handoff_reason && showHandoffReason && <> · handoff reason: {detail.handoff_reason}</>}
                  {" "}· started {relativeTime(detail.started_at)} ago
                  {" "}· {detail.assigned_email ? `Assigned: ${detail.assigned_email}` : "Unassigned"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showHandoffReason && <span className="chip chip-rejected">Needs human</span>}
                {!showHandoffReason && <StatusChip status={detail.status} />}
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto py-4">
              {detail.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {detail.status === "human" && (
                <p className="text-center text-[11px] text-muted">— handed off to staff, bot paused —</p>
              )}
            </div>
            {allowReply && (
              <form
                onSubmit={(e) => { e.preventDefault(); void sendReply(); }}
                className="flex gap-2 border-t border-line pt-3"
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply…"
                  disabled={sending}
                  className="flex-1 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <button type="submit" disabled={sending || !reply.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  Send
                </button>
              </form>
            )}
            {renderActions && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                {renderActions(detail, refresh)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message: m }: { message: Message }) {
  const cards = m.metadata?.cards ?? [];
  const verifier = m.metadata?.verifier;
  const [showSources, setShowSources] = useState(false);
  const toolCalls = m.metadata?.tool_calls ?? [];

  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-xl bg-tint px-3.5 py-2 text-sm text-ink">
          {m.content}
          <div className="mt-1 text-right text-[10px] text-muted">Student · {formatTime(m.timestamp)}</div>
        </div>
      </div>
    );
  }
  if (m.role === "staff") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-xl bg-accent px-3.5 py-2 text-sm text-white">
          {m.content}
          <div className="mt-1 text-right text-[10px] opacity-80">
            Staff · {formatTime(m.timestamp)}
            {m.delivery_status && <> · {deliveryStatusLabel(m.delivery_status)}</>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-xl bg-surface px-3.5 py-2 text-sm text-ink" style={{ border: "1px solid var(--line)" }}>
          {m.content}
        </div>
        {cards.map((c, i) => (
          <div key={i} className="rounded-lg bg-tint px-3 py-2 text-xs text-ink">
            <strong>{c.value}</strong> · {c.label}
            {c.as_of && <> · as of {c.as_of}</>}
            {c.stale && <span className="ml-1 chip chip-rejected">stale</span>}
          </div>
        ))}
        {(toolCalls.length > 0 || verifier) && (
          <div>
            <button onClick={() => setShowSources((v) => !v)} className="text-[11px] font-semibold text-accent hover:underline">
              {showSources ? "Hide sources" : "Show sources"}
            </button>
            {showSources && (
              <div className="mt-1 rounded-lg bg-tint px-3 py-2 text-[11px] text-ink-2">
                {toolCalls.map((t, i) => (
                  <div key={i}>{t.name} → {Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join(" · ")} ({String(t.status)})</div>
                ))}
                {verifier && (
                  <div className={`mt-1 font-medium ${verifier.ok ? "" : ""}`} style={{ color: verifier.ok ? "var(--chip-approved-fg)" : "var(--chip-rejected-fg)" }}>
                    {verifier.ok ? "✓ Verifier passed — all figures matched tool output" : "⚠ Verifier flagged unsupported figures"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <span>Enrollium · {formatTime(m.timestamp)}</span>
          {m.rating != null && <span>{m.rating === 1 ? "👍" : "👎 flagged by student"}</span>}
        </div>
      </div>
    </div>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "whatsapp") return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-accent"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
}
const channelLabel = (c: string) => (c === "whatsapp" ? "WhatsApp" : "Web");
const formatTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** WhatsApp delivery-status callbacks (PRD 6.2: "failures are visible in the tenant dashboard"). Web replies
 * never get one (delivery_status stays null), so this only ever renders for WhatsApp staff replies. */
function deliveryStatusLabel(status: string) {
  if (status === "failed") return <span style={{ color: "var(--chip-rejected-fg)" }}>⚠ delivery failed</span>;
  if (status === "read") return "✓✓ read";
  if (status === "delivered") return "✓✓ delivered";
  if (status === "sent") return "✓ sent";
  return status;
}
function relativeTime(ts: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export async function escalate(id: string, reason?: string) {
  await apiFetch(`/api/v1/conversations/${id}/escalate`, { method: "POST", body: JSON.stringify({ reason }) });
}
