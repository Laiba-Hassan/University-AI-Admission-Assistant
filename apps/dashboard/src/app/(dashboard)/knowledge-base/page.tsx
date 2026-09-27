"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

const ENTITIES = [
  ["programs", "Programs"], ["fee-items", "Fees"], ["intakes", "Intakes"], ["requirements", "Requirements"],
  ["faculties", "Faculties"], ["campuses", "Campuses"], ["scholarships", "Scholarships"], ["faqs", "FAQs"],
] as const;
type Entity = (typeof ENTITIES)[number][0];

// A row from any KB table -- loosely typed since each entity has different (joined) columns, rendered by
// picking a small, entity-specific set of fields below.
type Row = Record<string, unknown> & { id: string; status?: string; approved?: boolean };
interface Warning { count: number; detail: string }

export default function KnowledgeBasePage() {
  const [entity, setEntity] = useState<Entity>("fee-items");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);

  const load = () => {
    setRows(null); setWarning(null);
    void apiJson<{ data: Row[]; warning: Warning | null }>(`/api/v1/kb-entities/${entity}`)
      .then((r) => { setRows(r.data.map(withDerivedFields)); setWarning(r.warning); })
      .catch(() => setRows([]));
  };
  useEffect(load, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(id: string) {
    await apiFetch(`/api/v1/kb/${entity}/${id}/approve`, { method: "POST" });
    load();
  }

  const columns = columnsFor(entity);
  const entityLabel = ENTITIES.find(([k]) => k === entity)![1];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-[26px] font-semibold text-ink">Knowledge Base Editor</h1>
        </div>
        <Link href="/knowledge-base/history" className="rounded-lg border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-tint">
          ⟲ View change history
        </Link>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[180px_1fr_300px]">
        <nav className="card flex flex-row gap-1 overflow-x-auto p-2 xl:flex-col xl:overflow-visible">
          {ENTITIES.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setEntity(key)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium ${entity === key ? "bg-tint text-accent" : "text-ink-2 hover:bg-tint"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-ink">{entityLabel}</h2>
            <Link href={`/knowledge-base/import?target=${entity}`} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">
              + New {singular(entityLabel)}
            </Link>
          </div>

          {warning && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
              <span aria-hidden>⚠</span>
              <span className="text-ink-2"><strong className="text-ink">{warning.count} validation warning{warning.count === 1 ? "" : "s"}</strong> — {warning.detail}</span>
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <tr>{columns.map((c) => <th key={c.key} className="px-3 py-2.5">{c.label}</th>)}<th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows === null && <tr><td className="px-3 py-4 text-muted" colSpan={columns.length + 2}>Loading…</td></tr>}
                {rows?.length === 0 && <tr><td className="px-3 py-4 text-muted" colSpan={columns.length + 2}>No records yet.</td></tr>}
                {rows?.map((r) => {
                  if (r.no_data) {
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2.5 text-ink">{r.program_name as string}</td>
                        <td className="px-3 py-2.5 italic text-muted" colSpan={columns.length - 1}>No fee data on record</td>
                        <td className="px-3 py-2.5"><span className="chip chip-rejected">Missing</span></td>
                        <td className="px-3 py-2.5">
                          <Link href={`/knowledge-base/import?target=${entity}`} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-tint">Add fee</Link>
                        </td>
                      </tr>
                    );
                  }
                  const isDraft = "approved" in r ? !r.approved : r.status === "draft";
                  const isMissing = missingLabel(entity, r);
                  return (
                    <tr key={r.id}>
                      {columns.map((c) => <td key={c.key} className="px-3 py-2.5 text-ink-2">{formatFieldCell(entity, c.key, r)}</td>)}
                      <td className="px-3 py-2.5">
                        {isMissing ? <span className="chip chip-rejected">Missing</span> : <span className={`chip ${isDraft ? "chip-draft" : "chip-approved"}`}>{isDraft ? "Draft" : "Approved"}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {isMissing ? (
                          <Link href={`/knowledge-base/import?target=${entity}`} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-tint">Add details</Link>
                        ) : isDraft ? (
                          <button onClick={() => approve(r.id)} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90">Approve</button>
                        ) : <span className="text-xs text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted">Editors and Admins can approve records · Viewers have read-only access.</p>
        </div>

        <TestChatPanel />
      </div>
    </div>
  );
}

function TestChatPanel() {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "user", text: "What's the BSCS fee?" },
    { role: "assistant", text: "BSCS is PKR 145,000 per semester at Main Campus (local students) — as of Sep 18, 2026." },
  ]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask() {
    const text = q.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setQ(""); setBusy(true);
    try {
      const res = await apiFetch("/api/v1/kb/test-chat", { method: "POST", body: JSON.stringify({ message: text }) });
      const body = (await res.json()) as { reply?: string; error?: string };
      setMessages((m) => [...m, { role: "assistant", text: body.reply ?? "The assistant is unavailable right now — try again in a moment." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "The assistant is unavailable right now — try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        Test chat
      </div>
      <p className="mt-1 text-xs text-muted">Ask the bot to confirm a change instantly</p>
      <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${m.role === "user" ? "bg-tint text-ink" : "bg-accent/10 text-ink"}`} style={m.role === "assistant" ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-muted">Thinking…</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question…"
          disabled={busy}
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-60">Ask</button>
      </form>
    </div>
  );
}

function columnsFor(entity: Entity): { key: string; label: string }[] {
  const c = (key: string, label: string) => ({ key, label });
  switch (entity) {
    case "programs": return [c("name", "Program"), c("degree_level", "Level"), c("faculty_name", "Faculty"), c("campuses", "Campus"), c("total_credit_hours", "Credit hours")];
    case "fee-items": return [c("program_name", "Program"), c("campus_name", "Campus"), c("amount_display", "Amount"), c("per", "Per"), c("effective_from", "Effective from"), c("last_verified_at", "Last verified")];
    case "intakes": return [c("program_name", "Program"), c("intake_name", "Intake"), c("application_deadline", "Application deadline"), c("seats", "Seats")];
    case "requirements": return [c("program_name", "Program"), c("eligibility", "Eligibility"), c("required_documents", "Documents")];
    case "faculties": return [c("name", "Faculty"), c("campuses", "Campus"), c("program_count", "Programs")];
    case "campuses": return [c("name", "Campus"), c("city", "City"), c("address", "Address"), c("programs_offered", "Programs offered")];
    case "scholarships": return [c("name", "Scholarship"), c("coverage", "Coverage"), c("criteria", "Eligibility"), c("deadline", "Deadline")];
    case "faqs": return [c("question", "Question"), c("answer", "Answer")];
  }
}

function missingLabel(entity: Entity, r: Row): boolean {
  if (entity === "intakes") return r.application_deadline == null;
  if (entity === "campuses") return r.address == null;
  if (entity === "faqs") return r.answer === "";
  return false;
}

function withDerivedFields(r: Row): Row {
  if (r.no_data) return r;
  if ("amount" in r && "currency" in r && r.amount != null) {
    const studentType = r.student_type === "international" ? "International" : r.student_type === "local" ? "Local" : null;
    return {
      ...r,
      amount_display: `${r.currency} ${Number(r.amount).toLocaleString()}`,
      program_name: studentType ? `${r.program_name as string} — ${studentType}` : r.program_name,
    };
  }
  return r;
}

/** Most cells just format-and-print (formatCell), but a few carry their own real-data warning styling the
 * reference shows inline, not just in the row's overall Status chip: a missing effective date reads "⚠ Missing"
 * in red, and a stale verification date reads with a warning triangle in amber -- both computed server-side
 * from real thresholds (kb-entities.ts), never guessed at in the UI. */
function formatFieldCell(entity: Entity, key: string, r: Row) {
  if (entity === "fee-items" && key === "effective_from" && r.effective_from == null) {
    return <span className="font-semibold" style={{ color: "var(--chip-rejected-fg)" }}>⚠ Missing</span>;
  }
  if (entity === "fee-items" && key === "last_verified_at" && r.stale && r.last_verified_at != null) {
    return <span style={{ color: "var(--accent)" }}>⚠ {formatCell(r.last_verified_at)}</span>;
  }
  return formatCell(r[key]);
}

function formatCell(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && v.length > 80) return `${v.slice(0, 80)}…`;
  return String(v);
}

function singular(label: string) {
  return { Programs: "program", Fees: "fee item", Intakes: "intake", Requirements: "requirement", Faculties: "faculty", Campuses: "campus", Scholarships: "scholarship", FAQs: "FAQ" }[label] ?? label.toLowerCase();
}
