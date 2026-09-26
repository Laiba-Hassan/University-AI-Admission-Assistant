"use client";
import { useState } from "react";
import { ConversationSplit, escalate } from "@/components/ConversationSplit";

export default function ConversationsPage() {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const qs = new URLSearchParams({ ...(status && { status }), ...(channel && { channel }) }).toString();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[26px] font-semibold text-ink">Conversations</h1>
      </div>
      <div className="mt-4 flex gap-2">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All channels</option>
          <option value="web">Web</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="needs_human">Needs human</option>
          <option value="human">Human</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="mt-4">
        <ConversationSplit
          queryString={qs ? `?${qs}` : ""}
          emptyLabel="No conversations match these filters yet."
          renderActions={(d, refresh) => (
            d.status !== "needs_human" && d.status !== "human" ? (
              <button
                onClick={() => escalate(d.id, "escalated from Conversations").then(refresh)}
                className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                Escalate to Inbox →
              </button>
            ) : null
          )}
        />
      </div>
    </div>
  );
}
