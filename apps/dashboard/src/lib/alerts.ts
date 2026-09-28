"use client";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "./api";

export interface Alert { id: string; event_type: "lead_created" | "handoff_requested"; payload: Record<string, unknown>; created_at: string }

const LABEL: Record<Alert["event_type"], string> = { lead_created: "New lead captured", handoff_requested: "A student needs a person" };

/** Polls GET /api/v1/alerts every 5s -- real EventSource can't carry the Authorization header this API needs,
 * so a short poll is the practical "real-time" here (Phase 6A's web push covers the app-closed case). */
export function useAlerts(enabled: boolean) {
  const [toasts, setToasts] = useState<(Alert & { label: string })[]>([]);
  const [badge, setBadge] = useState(0);
  const since = useRef<string>(new Date().toISOString());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await apiJson<{ data: Alert[]; server_time: string }>(`/api/v1/alerts?since=${encodeURIComponent(since.current)}`);
        if (cancelled) return;
        if (res.data.length) {
          setToasts((t) => [...t, ...res.data.map((a) => ({ ...a, label: LABEL[a.event_type] }))].slice(-5));
          setBadge((b) => b + res.data.length);
          playChime();
          for (const a of res.data) notify(LABEL[a.event_type]);
        }
        since.current = res.server_time;
      } catch {
        // A single missed poll isn't worth surfacing; the next tick just tries again.
      }
    };
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  const clearBadge = () => setBadge(0);
  return { toasts, badge, dismiss, clearBadge };
}

/** Sidebar nav badges (Inbox, Unanswered): the persistent absolute counts the reference shows next to those two
 * items, polled independently of (and less often than) the toast-driving useAlerts above. */
export function useSidebarCounts(enabled: boolean) {
  const [counts, setCounts] = useState({ inbox: 0, unanswered: 0 });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      apiJson<{ inbox: number; unanswered: number }>("/api/v1/sidebar-counts").then((c) => { if (!cancelled) setCounts(c); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);
  return counts;
}

let audioCtx: AudioContext | null = null;
function playChime() {
  try {
    const prefs = JSON.parse(localStorage.getItem("enrollium-notify-sound") ?? "true");
    if (!prefs) return;
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
  } catch {
    // Autoplay policies can block this before any user gesture; a missed chime isn't worth surfacing an error for.
  }
}

/** A native OS notification while this tab/window is open (background push, Phase 6A, covers the fully-closed
 * case). Fires in any browser that has granted permission, and works unprompted inside the desktop app's
 * wrapper window (apps/desktop grants notification permission for its own loaded origin) -- no Electron-specific
 * code needed here, since Notification is a standard web API either way. */
function notify(title: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body: "Open the dashboard to see details.", silent: true }); // playChime() already covers sound
  } catch {
    // Notification construction can throw in odd embedded contexts; never let a notification failure break polling.
  }
}
