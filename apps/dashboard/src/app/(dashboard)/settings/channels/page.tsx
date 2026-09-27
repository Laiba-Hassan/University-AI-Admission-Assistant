"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { StatusChip } from "@/components/StatusChip";

interface Channels {
  web_widget: { public_key: string; allowed_origins: string[]; status: string } | null;
  whatsapp: { phone_number_id: string; display_number: string | null; template_status: string | null; status: string; connected_at: string | null } | null;
}

export default function ChannelsTab() {
  const [data, setData] = useState<Channels | null>(null);
  const load = () => { void apiJson<Channels>("/api/v1/settings/channels").then(setData).catch(() => setData({ web_widget: null, whatsapp: null })); };
  useEffect(load, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const waConnected = data.whatsapp?.status === "active";

  return (
    <div className="divide-y divide-line">
      <div className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">🌐 Web widget</div>
            {data.web_widget ? (
              <div className="text-xs text-ink-2">Allowed origins: {data.web_widget.allowed_origins.join(", ") || "none set"}</div>
            ) : <div className="text-xs text-muted">Not set up yet.</div>}
          </div>
          {data.web_widget && <StatusChip status={data.web_widget.status === "active" ? "closed" : "open"} />}
        </div>
      </div>
      <div className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">💬 WhatsApp</div>
            {waConnected ? (
              <div className="text-xs text-ink-2">
                {data.whatsapp!.display_number ?? data.whatsapp!.phone_number_id} · template: {data.whatsapp!.template_status?.split(":")[0] ?? "—"}
              </div>
            ) : <div className="text-xs text-muted">Not connected yet.</div>}
          </div>
          <StatusChip status={waConnected ? "closed" : "open"} />
        </div>

        {waConnected ? (
          <DisconnectButton onDone={load} />
        ) : (
          <ConnectForm onDone={load} />
        )}
      </div>
    </div>
  );
}

function DisconnectButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function disconnect() {
    setBusy(true);
    try { await apiFetch("/api/v1/settings/channels/whatsapp/disconnect", { method: "POST" }); onDone(); } finally { setBusy(false); }
  }
  return (
    <button onClick={disconnect} disabled={busy} className="mt-3 rounded-lg border px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60" style={{ borderColor: "var(--chip-rejected-fg)", color: "var(--chip-rejected-fg)" }}>
      {busy ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}

/** Meta's Embedded Signup needs the platform approved as a Tech Provider (PRD 6.2), which this project doesn't
 * have -- this is the documented fallback: a guided manual connection using credentials the admin copies from
 * their own Meta Business/App dashboard. The access token is encrypted server-side and never shown again once
 * saved (settings.ts / secrets.ts). */
function ConnectForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayNumber, setDisplayNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    if (!phoneNumberId.trim() || !accessToken.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch("/api/v1/settings/channels/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          phone_number_id: phoneNumberId.trim(), waba_id: wabaId.trim() || undefined,
          display_number: displayNumber.trim() || undefined, access_token: accessToken.trim(), template_name: templateName.trim() || undefined,
        }),
      });
      if (!res.ok) { setError(res.status === 403 ? "Only Admins can connect a WhatsApp number." : "Couldn't save that connection."); return; }
      setOpen(false); setAccessToken(""); onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90">
        Connect WhatsApp
      </button>
    );
  }

  return (
    <div className="mt-3 max-w-md space-y-3 rounded-lg border border-line p-4">
      <p className="text-xs text-ink-2">
        From your Meta Business dashboard: the phone number id, and a permanent access token for that number. See{" "}
        <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer" className="text-accent hover:underline">Meta's setup guide</a>.
      </p>
      <Field label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="123456789012345" required />
      <Field label="WhatsApp Business Account ID (optional)" value={wabaId} onChange={setWabaId} placeholder="109876543210" />
      <Field label="Display number (optional)" value={displayNumber} onChange={setDisplayNumber} placeholder="+1 555 010 0100" />
      <Field label="Access token" value={accessToken} onChange={setAccessToken} placeholder="EAAG..." type="password" required />
      <Field label="Approved follow-up template name (optional)" value={templateName} onChange={setTemplateName} placeholder="admissions_followup" hint="Used to reach a student outside the 24-hour reply window." />
      {error && <p className="text-xs" style={{ color: "var(--chip-rejected-fg)" }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={connect} disabled={busy || !phoneNumberId.trim() || !accessToken.trim()} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Connecting…" : "Save & connect"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs font-semibold text-ink-2 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
