"use client";
import { Fragment, useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Cluster { id: string; question_text: string; count: number; first_seen: string; last_seen: string; status: string }
interface Faq { id: string; question: string; approved: boolean }

export default function UnansweredPage() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [faqChoice, setFaqChoice] = useState("");
  const [q, setQ] = useState("");
  const [language, setLanguage] = useState("");

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
  function startLinking(id: string) {
    setLinking(linking === id ? null : id);
    setFaqChoice("");
    if (faqs === null) void apiJson<{ data: Faq[] }>("/api/v1/faqs").then((r) => setFaqs(r.data));
  }
  async function link(id: string) {
    if (!faqChoice) return;
    await apiFetch(`/api/v1/unanswered-questions/${id}/link`, { method: "POST", body: JSON.stringify({ faq_id: faqChoice }) });
    setLinking(null); load();
  }

  const filtered = (clusters ?? []).filter((c) => (!q || c.question_text.toLowerCase().includes(q.toLowerCase())) && (!language || detectLanguage(c.question_text) === language));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-[26px] font-semibold text-ink">Unanswered Questions</h1>
        </div>
        {clusters && <p className="text-sm text-ink-2">{clusters.length} open cluster{clusters.length === 1 ? "" : "s"} · grouped by embedding similarity</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs" />
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
          <option value="">All languages</option>
          <option value="English">English</option>
          <option value="Roman Urdu">Roman Urdu</option>
          <option value="Urdu">Urdu</option>
        </select>
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Count</th><th className="px-4 py-3">Question cluster</th><th className="px-4 py-3">Language</th>
              <th className="px-4 py-3">First seen</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clusters === null && <tr><td className="px-4 py-4 text-muted" colSpan={6}>Loading…</td></tr>}
            {clusters !== null && filtered.length === 0 && <tr><td className="px-4 py-4 text-muted" colSpan={6}>Nothing unanswered right now.</td></tr>}
            {filtered.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td className="px-4 py-3 font-semibold text-ink">{c.count}</td>
                  <td className={`px-4 py-3 text-ink ${detectLanguage(c.question_text) === "Urdu" ? "text-right" : ""}`} dir={detectLanguage(c.question_text) === "Urdu" ? "rtl" : "ltr"}>{c.question_text}</td>
                  <td className="px-4 py-3 text-ink-2">{detectLanguage(c.question_text)}</td>
                  <td className="px-4 py-3 text-ink-2">{new Date(c.first_seen).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-ink-2">{new Date(c.last_seen).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 text-xs font-semibold">
                      <button onClick={() => setDrafting(drafting === c.id ? null : c.id)} className="text-accent hover:underline">Draft FAQ</button>
                      <button onClick={() => startLinking(c.id)} className="text-ink-2 hover:underline">Link</button>
                      <button onClick={() => ignore(c.id)} className="text-ink-2 hover:underline">Ignore</button>
                    </div>
                  </td>
                </tr>
                {drafting === c.id && (
                  <tr>
                    <td colSpan={6} className="bg-panel px-4 py-3">
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
                {linking === c.id && (
                  <tr>
                    <td colSpan={6} className="bg-panel px-4 py-3">
                      <div className="flex gap-2">
                        <select value={faqChoice} onChange={(e) => setFaqChoice(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                          <option value="">Choose an existing FAQ…</option>
                          {faqs?.map((f) => <option key={f.id} value={f.id}>{f.question}</option>)}
                        </select>
                        <button onClick={() => link(c.id)} disabled={!faqChoice} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">Link</button>
                      </div>
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

/** A lightweight display-only language guess (script + common Roman Urdu tokens) for the Language column --
 * unanswered_questions has no stored language column, unlike conversations/messages which detect it live via
 * the agent (agent/language.ts). Good enough for grouping in this list; never used for anything the AI answers. */
function detectLanguage(text: string): "Urdu" | "Roman Urdu" | "English" {
  if (/[؀-ۿ]/.test(text)) return "Urdu";
  const romanUrduHints = /\b(kya|hai|kyun|kaise|kab|kahan|mein|ki|ka|ke|sakti|sakta|hoga|hogi|nahi|karo|karna)\b/i;
  return romanUrduHints.test(text) ? "Roman Urdu" : "English";
}
