"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Status {
  knowledge_done: boolean; branding_done: boolean; channels_done: boolean; widget_key: string | null;
  completed: boolean; completed_at: string | null;
}

// PRD 7: "Onboarding wizard (knowledge -> branding -> channels -> test -> go live)". Each step's status is real
// (derived from actual data by GET /api/v1/onboarding/status), and each step deep-links to the real settings
// page that does the actual editing rather than duplicating those forms here -- this is a guided checklist +
// a live test of the real widget, not a second copy of Settings.
export default function OnboardingPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [completing, setCompleting] = useState(false);

  const load = () => void apiJson<Status>("/api/v1/onboarding/status").then(setStatus);
  useEffect(load, []);

  async function goLive() {
    setCompleting(true);
    try { await apiFetch("/api/v1/onboarding/complete", { method: "POST" }); await load(); } finally { setCompleting(false); }
  }

  if (!status) return <p className="text-sm text-muted">Loading…</p>;

  const steps = [
    { done: status.knowledge_done, title: "Add your knowledge", body: "Import or add at least one approved program and fee item -- this is what the assistant answers from.", href: "/knowledge-base/import", cta: "Go to Knowledge Base" },
    { done: status.branding_done, title: "Set your branding", body: "A primary color and a welcome message, so the widget looks like your university, not a generic bot.", href: "/settings/branding", cta: "Go to Branding" },
    { done: status.channels_done, title: "Connect a channel", body: "Set up the web widget (WhatsApp is optional and can be added later).", href: "/settings/channels", cta: "Go to Channels" },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">Finish tenant setup</h1>
      <p className="mt-1.5 text-sm text-ink-2">Four steps to get your admissions assistant live.</p>

      {status.completed && (
        <div className="card mt-5 flex items-center gap-3 p-4" style={{ background: "var(--chip-approved-bg)" }}>
          <span className="text-lg">✓</span>
          <p className="text-sm font-semibold" style={{ color: "var(--chip-approved-fg)" }}>You&apos;re live. Setup completed {status.completed_at && new Date(status.completed_at).toLocaleDateString()}.</p>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <div key={s.title} className="card flex items-start justify-between gap-4 p-5">
            <div className="flex gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "chip-approved" : "chip-neutral"}`}>{s.done ? "✓" : i + 1}</span>
              <div>
                <div className="text-sm font-semibold text-ink">{s.title}</div>
                <p className="mt-0.5 max-w-md text-xs text-ink-2">{s.body}</p>
              </div>
            </div>
            <Link href={s.href} className="shrink-0 rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink hover:bg-tint">{s.cta}</Link>
          </div>
        ))}

        <div className="card p-5">
          <div className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${status.knowledge_done ? "chip-approved" : "chip-neutral"}`}>{status.knowledge_done ? "✓" : 4}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">Test it</div>
              <p className="mt-0.5 text-xs text-ink-2">Ask your real assistant a real question, against your real knowledge base -- the same agent the widget and WhatsApp use.</p>
              <TestChat disabled={!status.knowledge_done} />
            </div>
          </div>
        </div>

        <div className="card flex items-center justify-between gap-4 p-5">
          <div className="flex gap-3">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${status.completed ? "chip-approved" : "chip-neutral"}`}>{status.completed ? "✓" : 5}</span>
            <div>
              <div className="text-sm font-semibold text-ink">Go live</div>
              <p className="mt-0.5 max-w-md text-xs text-ink-2">Marks setup as done. Your assistant is already reachable through any connected channel regardless -- this just clears the checklist.</p>
            </div>
          </div>
          {!status.completed && (
            <button onClick={goLive} disabled={!allDone || completing} className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">
              {completing ? "Going live…" : "Go live"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface TestMsg { role: "user" | "assistant"; text: string }

function TestChat({ disabled }: { disabled: boolean }) {
  const [messages, setMessages] = useState<TestMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const value = input.trim();
    if (!value || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: value }]);
    setSending(true);
    try {
      const res = await apiFetch("/api/v1/kb/test-chat", { method: "POST", body: JSON.stringify({ message: value }) });
      const body = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "assistant", text: body.reply ?? "Sorry, something went wrong -- try again." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Sorry, something went wrong -- try again." }]);
    } finally {
      setSending(false);
    }
  }

  if (disabled) return <p className="mt-3 text-xs text-muted">Finish the Knowledge step first -- there&apos;s nothing to test against yet.</p>;

  return (
    <div className="mt-3 max-w-md rounded-lg border border-line">
      <div className="max-h-64 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-xs text-muted">Try &quot;What programs do you offer?&quot; or a real question a student might ask.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg px-3 py-1.5 text-sm ${m.role === "user" ? "ml-auto max-w-[85%] bg-accent text-white" : "max-w-[85%] bg-tint text-ink"}`}>{m.text}</div>
        ))}
        {sending && <div className="max-w-[85%] rounded-lg bg-tint px-3 py-1.5 text-sm text-muted">…</div>}
      </div>
      <div className="flex gap-2 border-t border-line p-2">
        <input
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask a question…" className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <button onClick={send} disabled={sending || !input.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}
