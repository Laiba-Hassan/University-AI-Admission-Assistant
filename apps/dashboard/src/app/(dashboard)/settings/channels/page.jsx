"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { WIDGET_URL } from "@/lib/config";
import { StatusChip } from "@/components/StatusChip";
export default function ChannelsTab() {
  const [data, setData] = useState(null);
  const load = () => {
    void apiJson("/api/v1/settings/channels").then(setData).catch(() => setData({
      web_widget: null,
      whatsapp: null
    }));
  };
  useEffect(load, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const waConnected = data.whatsapp?.status === "active";
  return <div className="divide-y divide-line">
      <div className="pb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Your plan</span>
          <span className={`chip ${data.whatsapp_enabled ? "chip-approved" : "chip-neutral"}`}>{data.whatsapp_enabled ? "Web + WhatsApp" : "Web only"}</span>
        </div>
        {!data.whatsapp_enabled && <p className="mt-1 text-xs text-muted">Reach out to us to add WhatsApp to your plan.</p>}
      </div>
      <div className="pb-4 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">🌐 Web widget</div>
            {data.web_widget ? <div className="text-xs text-ink-2">Allowed origins: {data.web_widget.allowed_origins.join(", ") || "none set"}</div> : <div className="text-xs text-muted">Not set up yet.</div>}
          </div>
          {data.web_widget && <StatusChip status={data.web_widget.status === "active" ? "closed" : "open"} />}
        </div>
        {data.web_widget ? <WidgetKeyPanel widget={data.web_widget} onDone={load} /> : <WidgetSetupForm onDone={load} />}
      </div>
      <div className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">💬 WhatsApp</div>
            {waConnected ? <div className="text-xs text-ink-2">
                {data.whatsapp.display_number ?? data.whatsapp.phone_number_id} · template: {data.whatsapp.template_status?.split(":")[0] ?? "—"}
              </div> : <div className="text-xs text-muted">Not connected yet.</div>}
          </div>
          <StatusChip status={waConnected ? "closed" : "open"} />
        </div>

        {waConnected ? <DisconnectButton onDone={load} /> : data.whatsapp_enabled ? <ConnectForm onDone={load} /> : <UpgradePrompt />}
      </div>
    </div>;
}
/** Shown instead of ConnectForm when tenant_limits.whatsapp_enabled is off -- the Web-only plan. Telling the
 * admin this up front (rather than letting them fill in Meta credentials that would then just 403) is the whole
 * point of exposing the flag on GET /settings/channels instead of only enforcing it server-side. */
function UpgradePrompt() {
  return <div className="mt-3 max-w-md rounded-lg border border-line p-4">
      <p className="text-sm font-semibold text-ink">WhatsApp isn&apos;t included on your plan yet.</p>
    </div>;
}
function DisconnectButton({
  onDone
}) {
  const [busy, setBusy] = useState(false);
  async function disconnect() {
    setBusy(true);
    try {
      await apiFetch("/api/v1/settings/channels/whatsapp/disconnect", {
        method: "POST"
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return <button onClick={disconnect} disabled={busy} className="mt-3 rounded-lg border px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60" style={{
    borderColor: "var(--chip-rejected-fg)",
    color: "var(--chip-rejected-fg)"
  }}>
      {busy ? "Disconnecting…" : "Disconnect"}
    </button>;
}

/** Meta's Embedded Signup needs the platform approved as a Tech Provider (PRD 6.2), which this project doesn't
 * have -- this is the documented fallback: a guided manual connection using credentials the admin copies from
 * their own Meta Business/App dashboard. The access token is encrypted server-side and never shown again once
 * saved (settings.ts / secrets.ts). */
function ConnectForm({
  onDone
}) {
  const [open, setOpen] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayNumber, setDisplayNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function connect() {
    if (!phoneNumberId.trim() || !accessToken.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/settings/channels/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          phone_number_id: phoneNumberId.trim(),
          waba_id: wabaId.trim() || undefined,
          display_number: displayNumber.trim() || undefined,
          access_token: accessToken.trim(),
          template_name: templateName.trim() || undefined
        })
      });
      if (!res.ok) {
        setError(res.status === 403 ? "Only Admins can connect a WhatsApp number." : "Couldn't save that connection.");
        return;
      }
      setOpen(false);
      setAccessToken("");
      onDone();
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return <button onClick={() => setOpen(true)} className="mt-3 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90">
        Connect WhatsApp
      </button>;
  }
  return <div className="mt-3 max-w-md space-y-3 rounded-lg border border-line p-4">
      <p className="text-xs text-ink-2">
        From your Meta Business dashboard: the phone number id, and a permanent access token for that number. See{" "}
        <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer" className="text-accent hover:underline">Meta's setup guide</a>.
      </p>
      <Field label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="123456789012345" required />
      <Field label="WhatsApp Business Account ID (optional)" value={wabaId} onChange={setWabaId} placeholder="109876543210" />
      <Field label="Display number (optional)" value={displayNumber} onChange={setDisplayNumber} placeholder="+1 555 010 0100" />
      <Field label="Access token" value={accessToken} onChange={setAccessToken} placeholder="EAAG..." type="password" required />
      <Field label="Approved follow-up template name (optional)" value={templateName} onChange={setTemplateName} placeholder="admissions_followup" hint="Used to reach a student outside the 24-hour reply window." />
      {error && <p className="text-xs" style={{
      color: "var(--chip-rejected-fg)"
    }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={connect} disabled={busy || !phoneNumberId.trim() || !accessToken.trim()} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Connecting…" : "Save & connect"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs font-semibold text-ink-2 hover:underline">Cancel</button>
      </div>
    </div>;
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  hint
}) {
  return <label className="block">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>;
}
const embedSnippet = key => `<script src="${WIDGET_URL}/loader.js" data-widget-key="${key}" data-api="${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}" data-widget-origin="${WIDGET_URL}"></script>`;
function WidgetKeyPanel({
  widget,
  onDone
}) {
  const [editingOrigins, setEditingOrigins] = useState(false);
  const [origins, setOrigins] = useState(widget.allowed_origins.join("\n"));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  async function saveOrigins() {
    setBusy(true);
    try {
      await apiFetch("/api/v1/settings/channels/widget", {
        method: "PATCH",
        body: JSON.stringify({
          allowed_origins: origins.split("\n").map(s => s.trim()).filter(Boolean)
        })
      });
      setEditingOrigins(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  async function copySnippet() {
    await navigator.clipboard.writeText(embedSnippet(widget.public_key));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  async function rotate() {
    if (!confirm("This immediately invalidates the current key -- the old embed snippet will stop working until you update it. Continue?")) return;
    setRotating(true);
    try {
      await apiFetch("/api/v1/settings/channels/widget/rotate", {
        method: "POST"
      });
      onDone();
    } finally {
      setRotating(false);
    }
  }
  return <div className="mt-3 max-w-lg space-y-3 rounded-lg border border-line p-4">
      <div>
        <span className="text-xs font-medium text-ink-2">Embed this on your site</span>
        <div className="mt-1 flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-lg bg-tint px-3 py-2 text-[11px] text-ink">{embedSnippet(widget.public_key)}</pre>
          <button onClick={copySnippet} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-tint">{copied ? "Copied!" : "Copy"}</button>
        </div>
      </div>

      {editingOrigins ? <div>
          <span className="text-xs font-medium text-ink-2">Allowed origins (one per line -- your site's real URL(s))</span>
          <textarea value={origins} onChange={e => setOrigins(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="https://admissions.example.edu" />
          <div className="mt-2 flex gap-2">
            <button onClick={saveOrigins} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">Save</button>
            <button onClick={() => setEditingOrigins(false)} className="text-xs font-semibold text-ink-2 hover:underline">Cancel</button>
          </div>
        </div> : <button onClick={() => setEditingOrigins(true)} className="text-xs font-semibold text-accent hover:underline">Edit allowed origins</button>}

      <div className="border-t border-line pt-3">
        <button onClick={rotate} disabled={rotating} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-60" style={{
        borderColor: "var(--chip-rejected-fg)",
        color: "var(--chip-rejected-fg)"
      }}>
          {rotating ? "Rotating…" : "Rotate key"}
        </button>
        <p className="mt-1 text-[11px] text-muted">Only if this key leaked -- immediately breaks the current embed until you swap in the new one.</p>
      </div>
    </div>;
}
function WidgetSetupForm({
  onDone
}) {
  const [origins, setOrigins] = useState("");
  const [busy, setBusy] = useState(false);
  async function setUp() {
    setBusy(true);
    try {
      await apiFetch("/api/v1/settings/channels/widget", {
        method: "POST",
        body: JSON.stringify({
          allowed_origins: origins.split("\n").map(s => s.trim()).filter(Boolean)
        })
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return <div className="mt-3 max-w-md space-y-3 rounded-lg border border-line p-4">
      <p className="text-xs text-ink-2">The domain(s) your site will embed the widget from -- one per line. This is what keeps other sites from using your widget key.</p>
      <textarea value={origins} onChange={e => setOrigins(e.target.value)} rows={2} placeholder="https://admissions.example.edu" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      <button onClick={setUp} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {busy ? "Setting up…" : "Set up web widget"}
      </button>
    </div>;
}