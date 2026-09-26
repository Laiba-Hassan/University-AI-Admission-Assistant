"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import { apiFetch, apiJson } from "@/lib/api";

const ENTITIES = [
  ["programs", "Programs"], ["fee-items", "Fees"], ["intakes", "Intakes"], ["requirements", "Requirements"],
  ["faculties", "Faculties"], ["campuses", "Campuses"], ["scholarships", "Scholarships"], ["faqs", "FAQs"],
] as const;

// A row from any KB table, loosely typed since each has different columns -- rendered generically below by
// picking a small set of well-known fields to show and letting the rest stay in the raw JSON for now.
type Row = Record<string, unknown> & { id: string; status?: string; approved?: boolean };

export default function KnowledgeBasePage() {
  const [entity, setEntity] = useState<(typeof ENTITIES)[number][0]>("programs");
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = () => { setRows(null); void apiJson<{ data: Row[] }>(`/api/v1/${entity}`).then((r) => setRows(r.data)).catch(() => setRows([])); };
  useEffect(load, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(id: string) {
    await apiFetch(`/api/v1/kb/${entity}/${id}/approve`, { method: "POST" });
    load();
  }

  const columns = columnsFor(entity);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[26px] font-semibold text-ink">Knowledge Base Editor</h1>
        <Link href="/knowledge-base/history" className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-tint">
          ⟲ View change history
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ENTITIES.map(([key, label]) => (
          <button key={key} onClick={() => setEntity(key)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${entity === key ? "border-accent bg-accent text-white" : "border-line text-ink-2"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>{columns.map((c) => <th key={c.key} className="px-4 py-3">{c.label}</th>)}<th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows === null && <tr><td className="px-4 py-4 text-muted" colSpan={columns.length + 2}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td className="px-4 py-4 text-muted" colSpan={columns.length + 2}>No records yet.</td></tr>}
            {rows?.map((r) => {
              const isDraft = "approved" in r ? !r.approved : r.status === "draft";
              return (
                <tr key={r.id}>
                  {columns.map((c) => <td key={c.key} className="px-4 py-3 text-ink-2">{formatCell(r[c.key])}</td>)}
                  <td className="px-4 py-3">
                    <StatusChip status={"approved" in r ? (r.approved ? "closed" : "needs_human") : (r.status ?? "open")} />
                  </td>
                  <td className="px-4 py-3">
                    {isDraft ? (
                      <button onClick={() => approve(r.id)} className="text-xs font-semibold text-accent hover:underline">Approve</button>
                    ) : <span className="text-xs text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function columnsFor(entity: string): { key: string; label: string }[] {
  switch (entity) {
    case "programs": return [["name", "Program"], ["code", "Code"], ["degree_level", "Level"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "fee-items": return [["academic_year", "Year"], ["student_type", "Student type"], ["item_type", "Item"], ["amount", "Amount"], ["currency", "Currency"], ["per", "Per"], ["last_verified_at", "Last verified"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "intakes": return [["intake_name", "Intake"], ["application_deadline", "Deadline"], ["test_date", "Test date"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "requirements": return [["eligibility", "Eligibility"], ["required_documents", "Documents"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "faculties": return [["name", "Faculty"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "campuses": return [["name", "Campus"], ["city", "City"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "scholarships": return [["name", "Scholarship"], ["coverage", "Coverage"], ["deadline", "Deadline"]].map(([key, label]) => ({ key: key!, label: label! }));
    case "faqs": return [["question", "Question"], ["answer", "Answer"]].map(([key, label]) => ({ key: key!, label: label! }));
    default: return [];
  }
}
function formatCell(v: unknown) {
  if (v == null) return "—";
  if (typeof v === "string" && v.length > 80) return `${v.slice(0, 80)}…`;
  return String(v);
}
