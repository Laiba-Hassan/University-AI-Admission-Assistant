"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { useStaffSession } from "@/lib/session";
export default function BrandingTab() {
  const session = useStaffSession();
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState(null);
  const fileInputRef = useRef(null);
  useEffect(() => {
    void apiJson("/api/v1/settings/branding").then(setData);
  }, []);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  async function save() {
    await apiFetch("/api/v1/settings/branding", {
      method: "PATCH",
      body: JSON.stringify({
        branding: data.branding,
        working_hours: data.working_hours,
        welcome_message: data.welcome_message
      })
    });
    // The sidebar's own logo comes from the shared session, not this page's local state -- without this it would
    // only pick up a just-uploaded logo on the next full reload instead of right after Save.
    session.setTenantLogo?.(data.branding.logo ?? null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  const accent = data.branding.accent || "#c15f3c";
  const welcome = data.welcome_message || "Ask me about programs, fees, deadlines or scholarships.";
  const logo = data.branding.logo;
  function onLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setLogoError("Please choose an image file.");
    if (file.size > 300 * 1024) return setLogoError("Keep the logo under 300KB.");
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = () => setData({
      ...data,
      branding: {
        ...data.branding,
        logo: reader.result
      }
    });
    reader.readAsDataURL(file);
  }
  return <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
      <div>
        <h2 className="font-heading text-lg font-semibold text-ink">Branding</h2>

        <div className="mt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Logo &amp; color</span>
          <div className="mt-2 flex items-center gap-3">
            {logo ? <img src={logo} alt="Logo" className="h-11 w-11 shrink-0 rounded-full border border-line object-contain bg-white" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent font-heading text-lg font-semibold text-accent">
                {(data.name || "?")[0].toUpperCase()}
              </span>}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint">
              {logo ? "Change logo" : "Upload logo"}
            </button>
            {logo && <button type="button" onClick={() => setData({
            ...data,
            branding: {
              ...data.branding,
              logo: null
            }
          })} className="text-xs font-semibold text-ink-2 hover:underline">Remove</button>}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onLogoChange} className="hidden" />
          </div>
          {logoError && <p className="mt-1.5 text-xs" style={{
          color: "var(--chip-rejected-fg)"
        }}>{logoError}</p>}
          <p className="mt-1.5 text-xs text-muted">Shown inside the chatbot widget header. PNG/SVG on a transparent or white background works best.</p>
          <div className="mt-3 flex items-center gap-3">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#c15f3c"} onChange={e => setData({
            ...data,
            branding: {
              ...data.branding,
              accent: e.target.value
            }
          })} className="h-9 w-9 cursor-pointer rounded-lg border border-line p-0.5" aria-label="Accent color" />
            <input value={data.branding.accent ?? ""} onChange={e => setData({
            ...data,
            branding: {
              ...data.branding,
              accent: e.target.value
            }
          })} placeholder="#C15F3C" className="w-28 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-2" />
          </div>
        </div>

        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Welcome message</span>
          <p className="mt-1 text-xs text-muted">The first thing a student sees when they open the chat widget.</p>
          <input value={data.welcome_message ?? ""} onChange={e => setData({
          ...data,
          welcome_message: e.target.value
        })} placeholder="Assalam-o-Alaikum! Ask me about programs, fees, deadlines or scholarships." className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Save changes</button>
          {saved && <span className="text-xs text-ink-2">Saved.</span>}
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Live widget preview</span>
        <div className="mt-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            {logo ? <img src={logo} alt="" className="h-6 w-6 shrink-0 rounded-full object-contain bg-white" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold" style={{
            borderColor: accent,
            color: accent
          }}>
                {(data.name || "?")[0].toUpperCase()}
              </span>}
            <span className="text-sm font-semibold text-ink">{data.name} Admissions</span>
          </div>
          <div className="mt-2 rounded-lg bg-tint px-3 py-2 text-xs text-ink">{welcome}</div>
        </div>
      </div>
    </div>;
}