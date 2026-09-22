// The postMessage protocol between the loader (running in the HOST PAGE's own context) and the widget iframe.
//
// Why a relay at all: the widget iframe is served from a shared origin (a CDN), the same for every university that
// embeds it. If the iframe made the API fetch() itself, the browser would send that iframe's own origin as the
// request's Origin header -- always the same origin, regardless of which host site embeds it -- which would make
// the backend's per-tenant origin allowlist meaningless. Instead the LOADER performs the fetch, because it executes
// unsandboxed in the host page: its requests carry the host page's real origin, which is what the widget key is
// actually allow-listed against.
export const CHANNEL = "uaa-widget";

export type ToLoader =
  | { channel: typeof CHANNEL; type: "ready" }
  | { channel: typeof CHANNEL; type: "fetch"; requestId: string; path: string; method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> }
  | { channel: typeof CHANNEL; type: "resize"; height: number }
  | { channel: typeof CHANNEL; type: "open" }
  | { channel: typeof CHANNEL; type: "close" }
  | { channel: typeof CHANNEL; type: "unread"; count: number };

export type ToWidget =
  | { channel: typeof CHANNEL; type: "init"; sessionId: string; apiOrigin: string }
  | { channel: typeof CHANNEL; type: "fetch-response"; requestId: string; status: number; body: unknown };
