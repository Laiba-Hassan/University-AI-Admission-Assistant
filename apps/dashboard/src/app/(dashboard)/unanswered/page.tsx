"use client";
import { Fragment, useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Cluster { id: string; question_text: string; count: number; first_seen: string; last_seen: string; status: string }

export default function UnansweredPage() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");

  const load = () => { void apiJson<{ data: Cluster[] }>("/api/v1/unanswered-questions?status=open").then((r) => setClusters(r.data)).catch(() => setClusters([])); };
  useEffect(load, []);

  async function draftFaq(id: string) {
    if (!answer.trim()) return;
    await apiFetch(`/api/v1/unanswered-questions/${id}/draft-faq`, { method: "POST", body: JSON.stringify({ answer: answer.trim() }) });
    setDrafting(null); setAnswer(""); load();
  }
  async function ignore(id: string) {
    await apiFetch(`/api/v1/unanswered-questions/${id}/ignore`, { method: "POST", body: "{}" });
    load();
  }

  return (
    <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">Unanswered Questions</h1>
      <p className="text-sm text-ink-2">Grouped by embedding similarity -- questions the assistant couldn&apos;t answer.</p>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-3">Count</th><th className="px-4 py-3">Question cluster</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clusters === null && <tr><td className="px-4 py-4 text-muted" colSpan={4}>Loading…</td></tr>}
            {clusters?.length === 0 && <tr><td className="px-4 py-4 text-muted" colSpan={4}>Nothing unanswered right now.</td></tr>}
            {clusters?.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td className="px-4 py-3 font-semibold text-ink">{c.count}</td>
                  <td className="px-4 py-3 text-ink">{c.question_text}</td>
                  <td className="px-4 py-3 text-ink-2">{new Date(c.last_seen).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 text-xs font-semibold">
                      <button onClick={() => setDrafting(drafting === c.id ? null : c.id)} className="text-accent hover:underline">Draft FAQ</button>
                      <button onClick={() => ignore(c.id)} className="text-ink-2 hover:underline">Ignore</button>
                    </div>
                  </td>
                </tr>
                {drafting === c.id && (
                  <tr>
                    <td colSpan={4} className="bg-panel px-4 py-3">
                      <div className="flex gap-2">
                        <input
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          placeholder="Write the FAQ answer…"
                          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                        />
                        <button onClick={() => draftFaq(c.id)} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white">Save as draft</button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">Saved as an unapproved FAQ -- review it in Knowledge Base before it reaches students.</p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
