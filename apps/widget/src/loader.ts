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
  launcher.setAttribute("aria-label", "Open admissions chat assistant");
  launcher.className = "uaa-launcher";
  launcher.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H7l-3 3V4z"/></svg>';

  const frameWrap = document.createElement("div");
  frameWrap.className = "uaa-frame-wrap uaa-hidden";
  const iframe = document.createElement("iframe");
  iframe.className = "uaa-iframe";
  iframe.title = "Admissions chat assistant";
  // allow="microphone" is required now so the mic button works without a second embed change when Phase 6B ships.
  iframe.setAttribute("allow", "microphone");
  iframe.src = `${opts.widgetOrigin}/widget.html?key=${encodeURIComponent(opts.widgetKey)}`;
  frameWrap.appendChild(iframe);

  const style = document.createElement("style");
  style.textContent = `
    .uaa-launcher { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%;
      background: var(--uaa-primary, #0B3D91); color: #fff; border: none; box-shadow: 0 4px 14px rgba(0,0,0,.22);
      cursor: pointer; z-index: 2147483000; display: flex; align-items: center; justify-content: center; }
    .uaa-frame-wrap { position: fixed; right: 20px; bottom: 88px; width: 380px; height: 600px; max-height: 80vh;
      z-index: 2147483000; box-shadow: 0 10px 40px rgba(0,0,0,.25); border-radius: 16px; overflow: hidden; }
    .uaa-iframe { width: 100%; height: 100%; border: 0; display: block; }
    .uaa-hidden { display: none; }
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
    frameWrap.classList.toggle("uaa-hidden", !open);
    launcher.setAttribute("aria-expanded", String(open));
  };
  launcher.addEventListener("click", () => setOpen(!open));

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
    else if (msg.type === "resize") frameWrap.style.height = `${Math.min(Math.max(msg.height, 320), window.innerHeight * 0.85)}px`;
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
