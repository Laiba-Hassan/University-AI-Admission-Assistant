"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
const TARGETS = [["programs", "Programs"], ["fee-items", "Fees"], ["intakes", "Intakes"], ["requirements", "Requirements"], ["faculties", "Faculties"], ["campuses", "Campuses"], ["scholarships", "Scholarships"], ["faqs", "FAQs"]];
function ImportForm() {
  const requested = useSearchParams().get("target");
  const [target, setTarget] = useState(requested && TARGETS.some(([k]) => k === requested) ? requested : "programs");
  const [mode, setMode] = useState("template");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    setBusy(true);
    setError(null);
    try {
      const res = mode === "ai" ? await apiFetch("/api/v1/import/ai-extract", {
        method: "POST",
        body: JSON.stringify({
          target,
          text: content
        })
      }) : await apiFetch("/api/v1/import/upload", {
        method: "POST",
        body: JSON.stringify({
          target,
          format: "csv",
          content
        })
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        const messages = {
          nothing_extracted: "Nothing that looked relevant was found in that text -- try pasting more of the source document.",
          extraction_unavailable: "The AI extraction service is unavailable right now -- try again shortly, or use the CSV/JSON template instead."
        };
        throw new Error(messages[b.error] ?? b.error ?? `Import failed (${res.status})`);
      }
      const body = await res.json();
      setResult(body);
      const d = await apiJson(`/api/v1/import/drafts?batch_id=${body.batch_id}`);
      setDrafts(d.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function review(id, action) {
    await apiFetch(`/api/v1/import/drafts/${id}/review`, {
      method: "POST",
      body: JSON.stringify({
        action
      })
    });
    setDrafts(ds => ds?.map(d => d.id === id ? {
      ...d,
      review_status: action === "accept" ? "accepted" : "rejected"
    } : d) ?? null);
  }
  return <div>
      <Link href="/knowledge-base" className="text-xs font-semibold text-accent hover:underline">← Back to Knowledge Base</Link>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Bulk Import</h1>
      <p className="text-sm text-ink-2">Upload a CSV file, or paste raw text for AI to extract from. Nothing reaches the live Knowledge Base until you review and accept each row.</p>

      <div className="mt-4 flex gap-1.5">
        {["template", "ai"].map(m => <button key={m} onClick={() => {
        setMode(m);
        setContent("");
        setResult(null);
        setDrafts(null);
        setError(null);
      }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${mode === m ? "border-accent bg-tint text-accent" : "border-line text-ink-2 hover:bg-tint"}`}>
            {m === "template" ? "CSV template" : "✨ AI-assisted (paste text)"}
          </button>)}
      </div>

      <div className="card mt-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select value={target} onChange={e => setTarget(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {mode === "template" && <>
              <label className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-tint">
                Upload CSV file…
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              const reader = new FileReader();
              reader.onload = () => setContent(String(reader.result ?? ""));
              reader.readAsText(file);
            }} />
              </label>
              {fileName && <span className="text-xs text-muted">{fileName}</span>}
            </>}
        </div>
        {mode === "ai" && <p className="mt-2 text-xs text-ink-2">Paste text from a prospectus, fee schedule, or similar -- an AI extracts {TARGETS.find(([v]) => v === target)[1].toLowerCase()}-shaped rows from it. Every row still needs your review below before anything is saved.</p>}
        {mode === "template" && <p className="mt-2 text-xs text-ink-2">Or paste CSV text directly below -- the first row must be the column headers shown in the placeholder.</p>}
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={mode === "ai" ? "Paste the source text here…" : templateFor(target)} rows={8} className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs" />
        {error && <p className="mt-2 text-sm" style={{
        color: "var(--chip-rejected-fg)"
      }}>{error}</p>}
        <button onClick={upload} disabled={busy || !content.trim()} className="mt-3 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? mode === "ai" ? "Extracting…" : "Uploading…" : mode === "ai" ? "Extract & validate" : "Upload & validate"}
        </button>
      </div>

      {result && <div className="card mt-4 p-5">
          <p className="text-sm text-ink">
            <strong>{result.staged}</strong> row{result.staged === 1 ? "" : "s"} staged for review
            {result.rejected.length > 0 && <> · <strong>{result.rejected.length}</strong> rejected before staging</>}
          </p>
          {result.rejected.length > 0 && <ul className="mt-2 space-y-1 text-xs" style={{
        color: "var(--chip-rejected-fg)"
      }}>
              {result.rejected.map(r => <li key={r.row}>Row {r.row}: {r.errors?.join("; ")}</li>)}
            </ul>}
        </div>}

      {drafts && drafts.length > 0 && <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Preview</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {drafts.map(d => <tr key={d.id}>
                  <td className="px-4 py-3 text-ink-2">{Object.entries(d.payload).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                  <td className="px-4 py-3"><span className={`chip ${d.review_status === "pending" ? "chip-draft" : d.review_status === "rejected" ? "chip-rejected" : "chip-approved"}`}>{d.review_status}</span></td>
                  <td className="px-4 py-3">
                    {d.review_status === "pending" ? <div className="flex gap-3 text-xs font-semibold">
                        <button onClick={() => review(d.id, "accept")} className="text-accent hover:underline">Accept</button>
                        <button onClick={() => review(d.id, "reject")} className="text-ink-2 hover:underline">Reject</button>
                      </div> : <span className="text-xs text-muted">—</span>}
                  </td>
                </tr>)}
            </tbody>
          </table>
        </div>}
    </div>;
}
function templateFor(target) {
  switch (target) {
    case "programs":
      return "name,code,degree_level\nBS Data Science,BSDS,bachelor";
    case "fee-items":
      return "program_code,academic_year,student_type,item_type,amount,currency,per\nBSDS,2026-27,local,tuition,145000,PKR,semester";
    case "intakes":
      return "program_code,intake_name,application_deadline,seats\nBSDS,Fall 2026,2026-08-15,80";
    case "requirements":
      return "program_code,eligibility,required_documents\nBSDS,Minimum 60% aggregate,Matric / O-Level transcript";
    case "faculties":
      return "name\nData Science";
    case "campuses":
      return "name,city,address\nNorth Campus,Islamabad,Sector G-9, Islamabad";
    case "scholarships":
      return "name,criteria,coverage,conditions\nMerit Scholarship,Top 10% in entry test,up to 50%,Renewed each semester";
    default:
      return "question,answer\nDo you offer online classes?,No.";
  }
}
export default function ImportPage() {
  return <Suspense fallback={null}>
      <ImportForm />
    </Suspense>;
}