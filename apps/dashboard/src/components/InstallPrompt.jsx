"use client";

import { useState, useSyncExternalStore } from "react";
import { canInstall, promptInstall, subscribeInstallPrompt } from "@/lib/installPrompt";

/** The install banner. "Not now" only hides it for this page view -- if dismissed, the same prompt is still
 * reachable from Settings > Notifications (see InstallAppRow) via the shared installPrompt module. */
export function InstallPrompt() {
  const installable = useSyncExternalStore(subscribeInstallPrompt, canInstall, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (!installable || dismissed) return null;
  return <div className="card fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 shadow-lg">
      <span className="text-sm text-ink">Install Enrollium for quick access from your home screen.</span>
      <button onClick={() => promptInstall()} className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
        Install
      </button>
      <button onClick={() => setDismissed(true)} className="text-xs text-muted hover:text-ink">Not now</button>
    </div>;
}
