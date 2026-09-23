// The loader: a small vanilla-JS script, no framework, that runs directly in the host page (never sandboxed).
// It is the one <script> tag a university adds to its site. See protocol.ts for why it -- not the iframe -- makes
// the actual API calls.
import { CHANNEL, type ToLoader, type ToWidget } from "./protocol.js";

interface Options { widgetKey: string; apiOrigin: string; widgetOrigin: string }

function currentScript(): HTMLScriptElement {
  const el = document.currentScript as HTMLScriptElement | null;
  if (el) return el;
  const scripts = document.getElementsByTagName("script");
  return scripts[scripts.length - 1]!;
}

function readOptions(script: HTMLScriptElement): Options {
  const widgetKey = script.dataset.widgetKey;
  if (!widgetKey) throw new Error("uaa-widget: data-widget-key is required on the loader <script> tag");
  const apiOrigin = (script.dataset.api ?? "").replace(/\/$/, "");
  if (!apiOrigin) throw new Error("uaa-widget: data-api is required on the loader <script> tag");
  const src = new URL(script.src);
  const widgetOrigin = (script.dataset.widgetOrigin ?? src.origin).replace(/\/$/, "");
  return { widgetKey, apiOrigin, widgetOrigin };
}

function sessionId(widgetKey: string): string {
  const key = `uaa_widget_session_${widgetKey}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, "");
    try { localStorage.setItem(key, id); } catch { /* private browsing: session just won't persist across loads */ }
  }
  return id;
}

function boot(opts: Options) {
  const sid = sessionId(opts.widgetKey);

  const launcher = document.createElement("button");
  launcher.setAttribute("aria-label", "Open AI Admissions Assistant");
  launcher.className = "uaa-launcher";
  // A sparkle mark reads as "AI assistant", not "send a message" -- this is a guided-answers assistant, not inbox/chat.
  launcher.innerHTML = `
    <svg class="uaa-launcher-icon" viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
      <path d="M12 2.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9L12 2.5z"/>
      <path d="M19 14.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z" opacity=".85"/>
    </svg>
    <svg class="uaa-launcher-close" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
  `;

  const frameWrap = document.createElement("div");
  frameWrap.className = "uaa-frame-wrap";
  const iframe = document.createElement("iframe");
  iframe.className = "uaa-iframe";
  iframe.title = "AI Admissions Assistant";
  // allow="microphone" is required now so the mic button works without a second embed change when Phase 6B ships.
  iframe.setAttribute("allow", "microphone");
  iframe.src = `${opts.widgetOrigin}/widget.html?key=${encodeURIComponent(opts.widgetKey)}`;
  frameWrap.appendChild(iframe);

  const style = document.createElement("style");
  style.textContent = `
    .uaa-launcher { position: fixed; right: 22px; bottom: 22px; width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, var(--uaa-primary, #0B3D91), color-mix(in srgb, var(--uaa-primary, #0B3D91) 70%, #000 15%));
      color: #fff; border: none; box-shadow: 0 8px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.06) inset;
      cursor: pointer; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease, box-shadow .15s ease; }
    .uaa-launcher:hover { transform: scale(1.06); box-shadow: 0 10px 28px rgba(0,0,0,.3); }
    .uaa-launcher:active { transform: scale(0.97); }
    .uaa-launcher-close { display: none; }
    .uaa-launcher[aria-expanded="true"] .uaa-launcher-icon { display: none; }
    .uaa-launcher[aria-expanded="true"] .uaa-launcher-close { display: block; }
    .uaa-frame-wrap { position: fixed; right: 22px; bottom: 98px; width: 420px; height: 680px; max-height: 82vh;
      z-index: 2147483000; box-shadow: 0 24px 64px rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.12); border-radius: 20px;
      overflow: hidden; background: #fff; opacity: 0; transform: translateY(18px) scale(.98); pointer-events: none;
      visibility: hidden; transition: opacity .22s ease, transform .22s ease, visibility 0s linear .22s; }
    .uaa-frame-wrap.uaa-open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; visibility: visible;
      transition: opacity .22s ease, transform .22s ease, visibility 0s linear 0s; }
    .uaa-iframe { width: 100%; height: 100%; border: 0; display: block; }
    @media (max-width: 480px) {
      .uaa-frame-wrap { right: 0; bottom: 0; width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
    }
  `;

  document.body.appendChild(style);
  document.body.appendChild(frameWrap);
  document.body.appendChild(launcher);

  let open = false;
  const setOpen = (v: boolean) => {
    open = v;
    frameWrap.classList.toggle("uaa-open", open);
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close AI Admissions Assistant" : "Open AI Admissions Assistant");
  };
  launcher.addEventListener("click", () => setOpen(!open));

  const MIN_HEIGHT = 420;
  let lastContentHeight = MIN_HEIGHT;
  const applyHeight = () => {
    const height = Math.max(Math.min(Math.max(lastContentHeight, MIN_HEIGHT), window.innerHeight * 0.85), MIN_HEIGHT);
    frameWrap.style.height = `${height}px`;
  };
  // Re-clamp if the browser window itself is resized after the panel opened (e.g. rotating a tablet), not just
  // when the iframe's own content height changes.
  window.addEventListener("resize", applyHeight);

  let initSent = false;
  const sendInit = () => {
    if (initSent) return; // "ready" can in principle arrive more than once; init is only ever sent the first time
    initSent = true;
    const init: ToWidget = { channel: CHANNEL, type: "init", sessionId: sid, apiOrigin: opts.apiOrigin };
    iframe.contentWindow?.postMessage(init, opts.widgetOrigin);
  };

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== opts.widgetOrigin) return; // only this widget's own iframe
    const msg = event.data as ToLoader | undefined;
    if (!msg || msg.channel !== CHANNEL) return;

    // The widget announces "ready" as soon as ITS OWN message listener is registered (at module load, before any
    // framework lifecycle) -- the one signal that is actually safe to wait on, unlike the iframe's "load" event,
    // which can fire before Preact has flushed its first effects and so races the handshake.
    if (msg.type === "ready") sendInit();
    else if (msg.type === "resize") {
      // The outer Math.max inside applyHeight is the actual fix: if window.innerHeight is ever transiently 0 or
      // tiny at the exact moment a resize message lands (observed in an automated preview pane before its viewport
      // settles), a bare Math.min alone would collapse the panel to ~0px with nothing to ever re-correct it after.
      lastContentHeight = msg.height;
      applyHeight();
    }
    else if (msg.type === "open") setOpen(true);
    else if (msg.type === "close") setOpen(false);
    else if (msg.type === "fetch") {
      let status = 0, body: unknown = null;
      try {
        const res = await fetch(`${opts.apiOrigin}${msg.path}`, {
          method: msg.method,
          headers: { "content-type": "application/json", "x-widget-key": opts.widgetKey, ...msg.headers },
          body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
        });
        status = res.status;
        body = await res.json().catch(() => null);
      } catch {
        status = 0; // network failure; the widget treats status 0 as "unavailable"
      }
      const reply: ToWidget = { channel: CHANNEL, type: "fetch-response", requestId: msg.requestId, status, body };
      iframe.contentWindow?.postMessage(reply, opts.widgetOrigin);
    }
  });
}

try {
  boot(readOptions(currentScript()));
} catch (err) {
  console.error(err);
}
