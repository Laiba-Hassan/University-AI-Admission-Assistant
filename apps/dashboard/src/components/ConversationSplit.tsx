"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { StatusChip } from "./StatusChip";

export interface ConversationRow {
  id: string; channel: string; status: string; display_id: string | null;
  last_message: string | null; language: string | null; has_lead: boolean; thumbs_down: boolean; last_message_at: string;
}
interface Message { id: string; role: string; content: string; detected_language: string | null; timestamp: string; metadata: Record<string, unknown>; rating: number | null }
interface Detail { id: string; status: string; display_id: string | null; channel: string; messages: Message[] }

/** The list+detail split both Conversations and Inbox use, differing only in which query params they pass in. */
export function ConversationSplit({ queryString, emptyLabel, renderActions, allowReply }: {
  queryString: string; emptyLabel: string; renderActions?: (d: Detail, refresh: () => void) => React.ReactNode; allowReply?: boolean;
}) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const loadList = () => apiJson<{ data: ConversationRow[] }>(`/api/v1/conversations${queryString}`).then((r) => {
    setRows(r.data);
    setSelected((cur) => cur ?? r.data[0]?.id ?? null);
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
      <div className="card divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`block w-full px-4 py-3 text-left ${selected === r.id ? "bg-tint" : "hover:bg-tint/50"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{r.display_id ?? "Unknown"}</span>
              <span className="shrink-0 text-[10px] text-muted">{new Date(r.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-2">{r.last_message ?? " "}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusChip status={r.status} />
              {r.language && <span className="chip chip-neutral">{r.language}</span>}
              {r.thumbs_down && <span className="chip chip-rejected">👎</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="card flex min-h-[420px] flex-col p-5">
        {!detail && <p className="text-sm text-muted">Select a conversation.</p>}
        {detail && (
          <>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <div className="text-sm font-semibold text-ink">{detail.display_id}</div>
                <div className="text-xs text-muted">{detail.channel} · started</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={detail.status} />
                {renderActions?.(detail, refresh)}
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto py-4">
              {detail.messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-xl px-3.5 py-2 text-sm ${m.role === "user" ? "bg-accent text-white" : "bg-tint text-ink"}`}>
                    {m.content}
                    {m.role === "assistant" && m.metadata.verifier != null && (
                      <div className="mt-1 text-[10px] opacity-70">
                        {(m.metadata.verifier as { ok: boolean }).ok ? "✓ verified" : "⚠ unverified"}
                      </div>
                    )}
                    {m.rating != null && <div className="mt-1 text-[10px] opacity-70">{m.rating === 1 ? "👍" : "👎"}</div>}
                  </div>
                </div>
              ))}
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
          </>
        )}
      </div>
    </div>
  );
}

export async function escalate(id: string, reason?: string) {
  await apiFetch(`/api/v1/conversations/${id}/escalate`, { method: "POST", body: JSON.stringify({ reason }) });
}
