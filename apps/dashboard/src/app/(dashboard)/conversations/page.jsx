"use client";

import { useState } from "react";
import { ConversationSplit } from "@/components/ConversationSplit";
export default function ConversationsPage() {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [language, setLanguage] = useState("");
  const [status, setStatus] = useState("");
  const [hasLead, setHasLead] = useState(false);
  const [thumbsDown, setThumbsDown] = useState(false);
  const qs = new URLSearchParams({
    ...(search && {
      search
    }),
    ...(channel && {
      channel
    }),
    ...(language && {
      language
    }),
    ...(status && {
      status
    }),
    ...(hasLead && {
      has_lead: "true"
    }),
    ...(thumbsDown && {
      thumbs_down: "true"
    })
  }).toString();
  return <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[26px] font-semibold text-ink">Conversations</h1>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs" />
        <select value={channel} onChange={e => setChannel(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All channels</option>
          <option value="web">Web</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <select value={language} onChange={e => setLanguage(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All languages</option>
          <option value="english">English</option>
          <option value="roman_urdu">Roman Urdu</option>
          <option value="urdu">Urdu</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="needs_human">Needs human</option>
          <option value="human">Human</option>
          <option value="closed">Closed</option>
        </select>
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={hasLead} onChange={e => setHasLead(e.target.checked)} /> Has lead
        </label>
        <button onClick={() => setThumbsDown(v => !v)} className={`rounded-lg border px-3 py-1.5 text-xs ${thumbsDown ? "border-accent bg-accent text-white" : "border-line text-ink-2"}`} title="Thumbs down only">
          👎 Thumbs down
        </button>
      </div>

      <div className="mt-4">
        <ConversationSplit queryString={qs ? `?${qs}` : ""} emptyLabel="No conversations match these filters yet." />
      </div>
    </div>;
}