import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { rpc, tellParent, waitForInit } from "./rpc.js";
import { isWithinWorkingHours } from "./working-hours.js";

type Lang = "english" | "roman_urdu" | "urdu";
type Detected = Lang | "other";
interface FactCard { type: "fee" | "intake"; label: string; value: string; as_of: string | null; stale?: boolean }
interface Msg { id: string; role: "user" | "assistant" | "system"; text: string; shown: string; language: Detected; cards?: FactCard[]; messageId?: string | null; rating?: 1 | -1 }
interface TenantConfig {
  name: string; branding: { primary?: string; accent?: string; logo?: string; tagline?: string };
  welcome_message: string; default_reply_script: Lang; suggested_questions: string[]; turnstile_site_key: string | null;
  working_hours?: Record<string, unknown>;
  localized_messages: { key: string; language: string; text: string }[];
}

const LANG_LABEL: Record<Lang, string> = { english: "English", roman_urdu: "Roman Urdu", urdu: "اردو" };
const uid = () => Math.random().toString(36).slice(2, 10);

function textFor(cfg: TenantConfig | null, key: string, lang: Lang): string {
  if (!cfg) return "";
  return cfg.localized_messages.find((m) => m.key === key && m.language === lang)?.text
    ?? cfg.localized_messages.find((m) => m.key === key && m.language === "english")?.text ?? "";
}

/** Cosmetic word-by-word reveal of an ALREADY-verified reply (verification happens server-side before anything is
 * sent to the widget at all -- this only paces how it appears, per PRD 6.1 "verified, then revealed progressively"). */
function useTypewriter(setMessages: (fn: (msgs: Msg[]) => Msg[]) => void) {
  return (id: string, fullText: string) => {
    const words = fullText.split(" ");
    let i = 0;
    const step = () => {
      i++;
      const shown = words.slice(0, i).join(" ");
      setMessages((msgs) => msgs.map((m) => (m.id === id ? { ...m, shown } : m)));
      if (i < words.length) setTimeout(step, 18 + Math.random() * 22);
    };
    step();
  };
}

function App() {
  const key = new URLSearchParams(location.search).get("key") ?? "";
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [langOverride, setLangOverride] = useState<Lang | null>(null);
  const [challengePass, setChallengePass] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [afterHours, setAfterHours] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const reveal = useTypewriter(setMessages);

  useEffect(() => {
    (async () => {
      const { sessionId: sid } = await waitForInit();
      setSessionId(sid);
      const cfgRes = await rpc("/api/widget/config", "GET");
      if (cfgRes.status !== 200) { setPhase("unavailable"); return; }
      const cfg = cfgRes.body as TenantConfig;
      setConfig(cfg);
      document.documentElement.style.setProperty("--uaa-primary", cfg.branding.primary ?? "#0B3D91");
      document.documentElement.style.setProperty("--uaa-accent", cfg.branding.accent ?? "#F2A900");
      setAfterHours(isWithinWorkingHours(cfg.working_hours as never) === false);
      setMessages([{ id: uid(), role: "system", text: cfg.welcome_message, shown: cfg.welcome_message, language: cfg.default_reply_script }]);
      setPhase("ready");

      // No Cloudflare site key configured (local/dev): the backend's own dev bypass ignores the token value, so a
      // placeholder is enough to get a pass. With a real site key, the widget waits for the visitor to complete it.
      if (!cfg.turnstile_site_key) requestPass(sid, "dev");
    })();
  }, []);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => { tellParent({ channel: "uaa-widget", type: "resize", height: document.body.scrollHeight } as never); }, [messages, phase, challengePass]);

  // Real Cloudflare Turnstile, only when the tenant's config actually carries a site key. Loads the widget script
  // once and renders the challenge into turnstileRef; its callback supplies the token requestPass needs.
  useEffect(() => {
    if (!config?.turnstile_site_key || challengePass) return;
    const w = window as unknown as { turnstile?: { render: (el: Element, opts: { sitekey: string; callback: (token: string) => void }) => void } };
    const mount = () => w.turnstile?.render(turnstileRef.current!, { sitekey: config.turnstile_site_key!, callback: (token) => requestPass(sessionId, token) });
    if (w.turnstile) { mount(); return; }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.onload = mount;
    document.head.appendChild(script);
  }, [config, sessionId, challengePass]);

  async function requestPass(sid: string, token: string): Promise<string | null> {
    const res = await rpc("/api/widget/session", "POST", { session_id: sid, turnstile_token: token });
    if (res.status !== 200) return null;
    const pass = (res.body as { challenge_pass: string }).challenge_pass;
    setChallengePass(pass); // for future turns; the CALLER still uses the returned value for this one (state updates are async)
    return pass;
  }

  const [pendingText, setPendingText] = useState<string | null>(null);

  // A pass obtained AFTER a message was queued (real Turnstile, completed mid-flow): send it now, once.
  useEffect(() => {
    if (challengePass && pendingText) { const text = pendingText; setPendingText(null); void deliver(text); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengePass]);

  /** The actual network call + response handling, separate from send() so a queued retry never re-appends the
   * user's bubble a second time. */
  async function deliver(value: string) {
    setSending(true);
    try {
      const chatBody = { message: value, session_id: sessionId, ...(langOverride ? { language: langOverride } : {}) };
      const passHeader = (pass: string | null): Record<string, string> => (pass ? { "x-challenge-pass": pass } : {});
      const res = await rpc("/api/chat", "POST", chatBody, passHeader(challengePass));
      if (res.status === 403 && (res.body as { error?: string })?.error === "challenge_required") {
        if (!config?.turnstile_site_key) {
          // No real site key configured (local/dev): the server's own dev bypass always accepts any token, so this
          // is safe to retry immediately -- it cannot loop, because requestPass is guaranteed to succeed here.
          const pass = await requestPass(sessionId, "dev");
          const res2 = await rpc("/api/chat", "POST", chatBody, passHeader(pass));
          return handleChatResponse(res2);
        }
        // A real Turnstile is configured: never retry with a placeholder token (it would just fail again forever).
        // Show the challenge again and resend once the visitor completes it and a fresh pass arrives.
        setChallengePass(null);
        setPendingText(value);
        return;
      }
      handleChatResponse(res);
    } catch {
      setPhase("unavailable");
    } finally {
      setSending(false);
    }
  }

  function handleChatResponse(res: { status: number; body: unknown }) {
    if (res.status !== 200) { setPhase("unavailable"); return; }
    const body = res.body as { reply: string; status: string; language: Detected; cards: FactCard[]; message_id: string | null };
    if (body.status === "human") return; // staff has taken over; stay silent
    const botId = uid();
    setMessages((m) => [...m, { id: botId, role: "assistant", text: body.reply, shown: "", language: body.language, cards: body.cards, messageId: body.message_id }]);
    reveal(botId, body.reply);
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || sending || !config) return;
    setInput("");
    setMessages((m) => [...m, { id: uid(), role: "user", text: value, shown: value, language: langOverride ?? "english" }]);
    await deliver(value);
  }

  async function handoff() {
    setMessages((m) => [...m, { id: uid(), role: "system", text: textFor(config, "handoff", langOverride ?? config?.default_reply_script ?? "english"), shown: textFor(config, "handoff", langOverride ?? config?.default_reply_script ?? "english"), language: "english" }]);
    await rpc("/api/chat/handoff", "POST", { session_id: sessionId, reason: "student used the Talk to admissions button" });
  }

  async function rate(msg: Msg, rating: 1 | -1) {
    if (!msg.messageId) return;
    setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, rating } : x)));
    await rpc("/api/chat/feedback", "POST", { message_id: msg.messageId, rating });
  }

  const chips = useMemo(() => config?.suggested_questions.slice(0, 4) ?? [], [config]);

  if (phase === "loading") return <div class="uaa-center"><div class="uaa-spinner" /></div>;
  if (phase === "unavailable") {
    return (
      <div class="uaa-root">
        <Header config={config} onHandoff={handoff} />
        <div class="uaa-unavailable">
          <p>This assistant is unavailable right now.</p>
          <p>Please contact admissions directly, or try again shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div class="uaa-root">
      <Header config={config} onHandoff={handoff} />
      {afterHours && <div class="uaa-banner">Our office is currently closed. I can still answer questions; staff will follow up during working hours.</div>}
      <div class="uaa-consent">This is an AI assistant. Messages are stored, and voice notes are transcribed and not kept.</div>
      <div class="uaa-body" ref={bodyRef}>
        {messages.map((m) => (
          <div key={m.id} class={`uaa-row uaa-row-${m.role}`}>
            <div class={`uaa-bubble uaa-bubble-${m.role}`} dir={m.language === "urdu" ? "rtl" : "ltr"}>
              {m.shown}
              {m.role === "assistant" && m.shown !== m.text && <span class="uaa-cursor" />}
            </div>
            {m.cards?.map((c, i) => (
              <div key={i} class={`uaa-card ${c.stale ? "uaa-card-stale" : ""}`}>
                <div class="uaa-card-label">{c.label}</div>
                <div class="uaa-card-value">{c.value}</div>
                {c.as_of && <div class="uaa-card-asof">as of {c.as_of}{c.stale ? " (may be outdated)" : ""}</div>}
              </div>
            ))}
            {m.role === "assistant" && m.messageId && m.shown === m.text && (
              <div class="uaa-thumbs">
                <button aria-label="Helpful" class={m.rating === 1 ? "uaa-thumb-active" : ""} onClick={() => rate(m, 1)}>👍</button>
                <button aria-label="Not helpful" class={m.rating === -1 ? "uaa-thumb-active" : ""} onClick={() => rate(m, -1)}>👎</button>
              </div>
            )}
          </div>
        ))}
        {sending && <div class="uaa-row uaa-row-assistant"><div class="uaa-bubble uaa-typing"><span /><span /><span /></div></div>}
      </div>
      {chips.length > 0 && !sending && (
        <div class="uaa-chips">{chips.map((q) => <button key={q} class="uaa-chip" onClick={() => send(q)}>{q}</button>)}</div>
      )}
      <div class="uaa-langbar">
        {(["english", "roman_urdu", "urdu"] as Lang[]).map((l) => (
          <button key={l} class={`uaa-lang ${langOverride === l ? "uaa-lang-active" : ""}`} onClick={() => setLangOverride(l)}>{LANG_LABEL[l]}</button>
        ))}
      </div>
      {config?.turnstile_site_key && !challengePass ? (
        <div class="uaa-turnstile-wrap">
          <p>Please complete the check below to continue.</p>
          <div ref={turnstileRef} />
        </div>
      ) : (
        <form class="uaa-inputbar" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input value={input} onInput={(e) => setInput((e.target as HTMLInputElement).value)} placeholder="Ask about programs, fees, deadlines…" disabled={sending} />
          <button type="submit" disabled={sending || !input.trim()} aria-label="Send">➤</button>
        </form>
      )}
      <button class="uaa-handoff" onClick={handoff}>Talk to admissions</button>
    </div>
  );
}

function Header({ config, onHandoff }: { config: TenantConfig | null; onHandoff: () => void }) {
  return (
    <div class="uaa-header">
      {config?.branding.logo && <img src={config.branding.logo} alt="" class="uaa-logo" />}
      <div class="uaa-header-text">
        <div class="uaa-header-name">{config?.name ?? "Admissions Assistant"}</div>
        {config?.branding.tagline && <div class="uaa-header-tagline">{config.branding.tagline}</div>}
      </div>
      <button class="uaa-close" aria-label="Close" onClick={() => tellParent({ channel: "uaa-widget", type: "close" } as never)}>✕</button>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
