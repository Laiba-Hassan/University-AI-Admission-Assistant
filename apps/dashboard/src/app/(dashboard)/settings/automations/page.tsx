"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";

interface Settings { webhook_url: string | null; enabled: boolean }

// PRD 7: "Event outbox backend support for n8n-style automations". The app never talks to n8n/Zapier itself --
// it POSTs every event (new lead, handoff requested, unanswered question logged, limit warning, daily usage
// report) as JSON to whatever URL is set here. Wiring that URL up to an email, a Google Sheet, a Slack message,
// etc. happens inside the tenant's own n8n/Zapier workflow, not in this app.
const EVENT_TYPES = [
  ["lead_created", "New lead captured"], ["handoff_requested", "Student asked for a person / conversation escalated"],
  ["unanswered_logged", "A question the assistant couldn't answer"], ["limit_warning", "Monthly conversation/message limit reached"],
  ["daily_usage_report", "Daily usage summary"],
] as const;

export default function AutomationsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "failed" | null>(null);

  useEffect(() => { void apiJson<Settings>("/api/v1/settings/automations").then((s) => { setSettings(s); setDraft(s.webhook_url ?? ""); }); }, []);
  if (!settings) return <p className="text-sm text-muted">Loading…</p>;

  async function save(patch: Partial<Settings>) {
    setSaving(true);
    try {
      await apiFetch("/api/v1/settings/automations", { method: "PATCH", body: JSON.stringify(patch) });
      setSettings((s) => (s ? { ...s, ...patch } : s));
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEvent() {
    setTesting(true); setTestResult(null);
    try {
      const res = await apiFetch("/api/v1/settings/automations/test", { method: "POST" });
      setTestResult(res.ok ? "ok" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false); setTimeout(() => setTestResult(null), 4000);
    }
  }

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold text-ink">Automations</h2>
      <p className="mt-2 max-w-xl text-sm text-ink-2">
        Send every conversation event to your own webhook -- point it at an n8n, Zapier or Make workflow to email
        yourself, log leads to a spreadsheet, or page staff. This app only delivers the JSON; what happens next is
        up to your workflow.
      </p>

      <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-muted">Webhook URL</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-n8n-instance.example/webhook/abc123"
          className="w-full max-w-md rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        <button onClick={() => save({ webhook_url: draft.trim() || null })} disabled={saving} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          Save
        </button>
        {saved && <span className="text-xs text-ink-2">Saved.</span>}
      </div>

      <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => save({ enabled: e.target.checked })} className="h-4 w-4 rounded border-line" />
        Deliver events to this webhook
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={sendTestEvent} disabled={testing || !settings.webhook_url}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-tint disabled:opacity-60"
        >
          {testing ? "Sending…" : "Send test event"}
        </button>
        {testResult === "ok" && <span className="text-xs font-medium" style={{ color: "var(--chip-approved-fg)" }}>Delivered -- check your workflow.</span>}
        {testResult === "failed" && <span className="text-xs font-medium" style={{ color: "var(--chip-rejected-fg)" }}>Couldn&apos;t reach that URL.</span>}
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Events sent</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
          {EVENT_TYPES.map(([type, label]) => (
            <li key={type} className="flex items-baseline gap-2">
              <code className="rounded bg-tint px-1.5 py-0.5 text-xs text-ink">{type}</code>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
