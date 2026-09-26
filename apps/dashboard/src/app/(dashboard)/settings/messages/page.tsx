"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Msg { key: string; language: string; text: string }
const KEYS = ["welcome", "fallback", "handoff", "after_hours"] as const;
const LANGS = ["english", "roman_urdu", "urdu"] as const;

export default function MessagesTab() {
  const [rows, setRows] = useState<Msg[] | null>(null);
  const load = () => { void apiJson<{ data: Msg[] }>("/api/v1/settings/messages").then((r) => setRows(r.data)); };
  useEffect(load, []);

  async function save(key: string, language: string, text: string) {
    await apiFetch("/api/v1/settings/messages", { method: "PATCH", body: JSON.stringify({ key, language, text }) });
    load();
  }

  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  const find = (k: string, l: string) => rows.find((r) => r.key === k && r.language === l)?.text ?? "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Message</th>{LANGS.map((l) => <th key={l} className="px-3 py-2">{l.replace("_", " ")}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {KEYS.map((k) => (
            <tr key={k}>
              <td className="px-3 py-2 font-medium capitalize text-ink">{k.replace("_", " ")}</td>
              {LANGS.map((l) => <EditableCell key={l} value={find(k, l)} onSave={(v) => save(k, l, v)} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <td className="px-3 py-2">
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        rows={2}
        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs"
      />
    </td>
  );
}
