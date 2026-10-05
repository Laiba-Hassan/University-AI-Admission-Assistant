"use client";

// Module-level singleton: `beforeinstallprompt` only ever fires once per page load, so whichever component
// mounts first must capture it -- everything else (the banner, the Settings row) reads the same captured
// event instead of each registering its own listener and losing the race.
let deferred = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export const subscribeInstallPrompt = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const canInstall = () => !!deferred && !installed;

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  notify();
  return choice.outcome === "accepted";
}
