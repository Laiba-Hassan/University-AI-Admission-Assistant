"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
const KEYS = [{
  key: "fallback",
  label: "Fallback"
}, {
  key: "handoff",
  label: "Handoff"
}, {
  key: "after_hours",
  label: "After-hours"
}];
const LANGS = [{
  key: "english",
  label: "English"
}, {
  key: "roman_urdu",
  label: "Roman Urdu"
}, {
  key: "urdu",
  label: "Urdu"
}];
export default function MessagesTab() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const load = () => {
    void apiJson("/api/v1/settings/messages").then(r => setRows(r.data));
  };
  useEffect(load, []);
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  const cell = (key, language) => rows.find(r => r.key === key && r.language === language)?.text ?? "";
  const cellKey = (key, language) => `${key}:${language}`;
  async function save(key, language) {
    await apiFetch("/api/v1/settings/messages", {
      method: "PATCH",
      body: JSON.stringify({
        key,
        language,
        text: draft
      })
    });
    setEditing(null);
    load();
  }
  return <div>
      <h2 className="font-heading text-lg font-semibold text-ink">Fixed messages</h2>
      <p className="text-sm text-ink-2">Fallback, handoff and after-hours text in all three languages.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2.5">Message</th>
              {LANGS.map(l => <th key={l.key} className="px-3 py-2.5">{l.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {KEYS.map(({
            key,
            label
          }) => <tr key={key}>
                <td className="px-3 py-3 font-semibold text-ink">{label}</td>
                {LANGS.map(l => {
              const ck = cellKey(key, l.key);
              const isEditing = editing === ck;
              return <td key={l.key} className="px-3 py-3 text-ink-2">
                      {isEditing ? <div className="flex flex-col gap-1.5">
                          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} className="w-full min-w-[180px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink" />
                          <div className="flex gap-2 text-xs font-semibold">
                            <button onClick={() => save(key, l.key)} className="text-accent hover:underline">Save</button>
                            <button onClick={() => setEditing(null)} className="text-ink-2 hover:underline">Cancel</button>
                          </div>
                        </div> : <button onClick={() => {
                  setEditing(ck);
                  setDraft(cell(key, l.key));
                }} className="block max-w-[260px] text-left hover:text-ink" title="Click to edit">
                          {cell(key, l.key) || <span className="text-muted">Not set</span>}
                        </button>}
                    </td>;
            })}
              </tr>)}
          </tbody>
        </table>
      </div>
    </div>;
}