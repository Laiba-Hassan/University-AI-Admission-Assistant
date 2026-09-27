"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

const TARGETS = [
  ["programs", "Programs"], ["fee-items", "Fees"], ["intakes", "Intakes"], ["requirements", "Requirements"],
  ["faculties", "Faculties"], ["campuses", "Campuses"], ["scholarships", "Scholarships"], ["faqs", "FAQs"],
] as const;
type Target = (typeof TARGETS)[number][0];
interface Draft { id: string; payload: Record<string, unknown>; review_status: string }
interface UploadResult { batch_id: string; staged: number; rejected: { row: number; errors: string[] }[] }

function ImportForm() {
  const requested = useSearchParams().get("target") as Target | null;
  const [target, setTarget] = useState<Target>(requested && TARGETS.some(([k]) => k === requested) ? requested : "programs");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch("/api/v1/import/upload", { method: "POST", body: JSON.stringify({ target, format, content }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `Upload failed (${res.status})`); }
      const body = (await res.json()) as UploadResult;
      setResult(body);
      const d = await apiJson<{ data: Draft[] }>(`/api/v1/import/drafts?batch_id=${body.batch_id}`);
      setDrafts(d.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, action: "accept" | "reject") {
    await apiFetch(`/api/v1/import/drafts/${id}/review`, { method: "POST", body: JSON.stringify({ action }) });
    setDrafts((ds) => ds?.map((d) => (d.id === id ? { ...d, review_status: action === "accept" ? "accepted" : "rejected" } : d)) ?? null);
  }

  return (
    <div>
      <Link href="/knowledge-base" className="text-xs font-semibold text-accent hover:underline">← Back to Knowledge Base</Link>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Bulk Import</h1>
      <p className="text-sm text-ink-2">Upload a CSV or JSON template. Nothing reaches the live Knowledge Base until you review and accept each row.</p>

      <div className="card mt-4 p-5">
        <div className="flex flex-wrap gap-3">
          <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={format === "csv" ? templateFor(target) : "Paste a JSON array of objects…"}
          rows={8}
          className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs"
        />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
        <button onClick={upload} disabled={busy || !content.trim()} className="mt-3 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? "Uploading…" : "Upload & validate"}
        </button>
      </div>

      {result && (
        <div className="card mt-4 p-5">
          <p className="text-sm text-ink">
            <strong>{result.staged}</strong> row{result.staged === 1 ? "" : "s"} staged for review
            {result.rejected.length > 0 && <> · <strong>{result.rejected.length}</strong> rejected before staging</>}
          </p>
          {result.rejected.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--chip-rejected-fg)" }}>
              {result.rejected.map((r) => <li key={r.row}>Row {r.row}: {r.errors?.join("; ")}</li>)}
            </ul>
          )}
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Preview</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-ink-2">{Object.entries(d.payload).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                  <td className="px-4 py-3"><span className={`chip ${d.review_status === "pending" ? "chip-draft" : d.review_status === "rejected" ? "chip-rejected" : "chip-approved"}`}>{d.review_status}</span></td>
                  <td className="px-4 py-3">
                    {d.review_status === "pending" ? (
                      <div className="flex gap-3 text-xs font-semibold">
                        <button onClick={() => review(d.id, "accept")} className="text-accent hover:underline">Accept</button>
                        <button onClick={() => review(d.id, "reject")} className="text-ink-2 hover:underline">Reject</button>
                      </div>
                    ) : <span className="text-xs text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function templateFor(target: string) {
  switch (target) {
    case "programs": return "name,code,degree_level\nBS Data Science,BSDS,bachelor";
    case "fee-items": return "program_code,academic_year,student_type,item_type,amount,currency,per\nBSDS,2026-27,local,tuition,145000,PKR,semester";
    case "intakes": return "program_code,intake_name,application_deadline,seats\nBSDS,Fall 2026,2026-08-15,80";
    case "requirements": return "program_code,eligibility,required_documents\nBSDS,Minimum 60% aggregate,Matric / O-Level transcript";
    case "faculties": return "name\nData Science";
    case "campuses": return "name,city,address\nNorth Campus,Islamabad,Sector G-9, Islamabad";
    case "scholarships": return "name,criteria,coverage,conditions\nMerit Scholarship,Top 10% in entry test,up to 50%,Renewed each semester";
    default: return "question,answer\nDo you offer online classes?,No.";
  }
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportForm />
    </Suspense>
  );
}
