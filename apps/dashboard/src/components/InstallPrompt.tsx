"use client";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

/** Chrome/Edge fire beforeinstallprompt only when the manifest + service worker installability criteria are
 * met; we capture it (preventing the browser's own mini-infobar) and show our own "install to home screen" banner. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferred || dismissed) return null;
  return (
    <div className="card fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 shadow-lg">
      <span className="text-sm text-ink">Install Enrollium for quick access from your home screen.</span>
      <button
        onClick={async () => { await deferred.prompt(); await deferred.userChoice; setDeferred(null); }}
        className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        Install
      </button>
      <button onClick={() => setDismissed(true)} className="text-xs text-muted hover:text-ink">Not now</button>
    </div>
  );
}
