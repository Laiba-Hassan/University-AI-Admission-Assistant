"use client";

import { apiFetch, apiJson } from "./api";

/** Web push subscribe/unsubscribe (PRD 6A: "opt-in in Settings"). Mirrors api/src/push.ts's PushSubscriptionInput
 * shape exactly. Every step can fail for ordinary reasons (no HTTPS in some dev setups, permission denied,
 * VAPID not configured) -- callers show a plain error rather than a stack trace. */

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export async function isPushSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return Boolean(sub);
}
export async function subscribeToPush() {
  if (!pushSupported()) return {
    ok: false,
    error: "Push notifications aren't supported in this browser."
  };
  const {
    key
  } = await apiJson("/api/v1/push/vapid-public-key");
  if (!key) return {
    ok: false,
    error: "Push notifications aren't configured for this deployment yet."
  };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return {
    ok: false,
    error: "Notification permission was denied."
  };
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key)
  }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return {
    ok: false,
    error: "This browser returned an incomplete subscription."
  };
  const res = await apiFetch("/api/v1/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys
    })
  });
  if (!res.ok) return {
    ok: false,
    error: "Couldn't save that subscription."
  };
  return {
    ok: true
  };
}
export async function unsubscribeFromPush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await apiFetch("/api/v1/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint
    })
  }).catch(() => {});
}

// Web Push's applicationServerKey wants a raw Uint8Array, not the base64url string the server hands back.
function urlBase64ToUint8Array(base64url) {
  const padding = "=".repeat((4 - base64url.length % 4) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}