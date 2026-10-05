// Runs inside the iframe. Never calls fetch() directly -- every API call is relayed through the parent (loader),
// which is what makes the widget key's origin check meaningful (see protocol.ts).
import { CHANNEL } from "./protocol.js";

// The listener is registered, and "ready" announced, at MODULE LOAD TIME (synchronously, before any framework
// lifecycle runs) -- not lazily inside waitForInit(). Registering it only when a component's effect happens to run
// loses the race against the parent's iframe "load" event, which can fire before Preact has flushed its first
// effects: postMessage does not queue for a listener that attaches after the event was dispatched, so a message
// sent to an empty window is simply gone. Announcing "ready" tells the parent exactly when it is safe to send init.
let parentOrigin = "*"; // narrowed to the real parent origin once "init" arrives
let initResolve;
const initPromise = new Promise(r => initResolve = r);
const pending = new Map();
window.addEventListener("message", event => {
  const msg = event.data;
  if (!msg || msg.channel !== CHANNEL) return;
  if (msg.type === "init") {
    parentOrigin = event.origin;
    initResolve({
      sessionId: msg.sessionId,
      apiOrigin: msg.apiOrigin
    });
  } else if (msg.type === "fetch-response") {
    const p = pending.get(msg.requestId);
    if (p) {
      pending.delete(msg.requestId);
      p.resolve({
        status: msg.status,
        body: msg.body
      });
    }
  }
});
window.parent.postMessage({
  channel: CHANNEL,
  type: "ready"
}, "*");
export function waitForInit() {
  return initPromise;
}
export async function rpc(path, method = "GET", body, headers) {
  await waitForInit();
  const requestId = Math.random().toString(36).slice(2);
  const send = {
    channel: CHANNEL,
    type: "fetch",
    requestId,
    path,
    method,
    body,
    headers
  };
  const promise = new Promise(resolve => pending.set(requestId, {
    resolve
  }));
  window.parent.postMessage(send, parentOrigin);
  return promise;
}

/** PRD 6B's mic button: posts a recorded clip's raw bytes (never JSON+base64 -- see protocol.ts) to the loader.
 * ArrayBuffer is structured-clone-transferable over postMessage, so this is a real zero-copy-ish handoff, not a
 * string round-trip. */
export async function rpcBinary(path, audio, contentType, headers) {
  await waitForInit();
  const requestId = Math.random().toString(36).slice(2);
  const send = {
    channel: CHANNEL,
    type: "fetch",
    requestId,
    path,
    method: "POST",
    body: audio,
    bodyContentType: contentType,
    headers
  };
  const promise = new Promise(resolve => pending.set(requestId, {
    resolve
  }));
  window.parent.postMessage(send, parentOrigin, [audio]); // transfer, not copy
  return promise;
}
export function tellParent(msg) {
  window.parent.postMessage(msg, parentOrigin === "*" ? "*" : parentOrigin);
}