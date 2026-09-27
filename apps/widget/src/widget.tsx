import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { rpc, rpcBinary, tellParent, waitForInit } from "./rpc.js";
import { isWithinWorkingHours } from "./working-hours.js";

// PRD 6B: "about 2 minutes per recording" -- stop automatically a little under the server's own MAX_VOICE_SECONDS
// (125s) so a clip is never silently rejected purely for running a few seconds past the client's own guess at it.
const MAX_RECORDING_MS = 120_000;
const VOICE_RETRY_TEXT: Record<Lang, string> = {
  english: "Sorry, I couldn't quite make that out. Try recording again, or type your question instead.",
  roman_urdu: "Maazrat, mujhe woh sunai nahi diya. Dobara record karein ya apna sawal type kar dein.",
  urdu: "معذرت، مجھے وہ سنائی نہیں دیا۔ دوبارہ ریکارڈ کریں یا اپنا سوال لکھ دیں۔",
};
const MIC_UNAVAILABLE_TEXT: Record<Lang, string> = {
  english: "Microphone access was denied. You can still type your question below.",
  roman_urdu: "Mic ki ijazat nahi mili. Aap neeche apna sawal type kar sakte hain.",
  urdu: "مائیک کی اجازت نہیں ملی۔ آپ نیچے اپنا سوال لکھ سکتے ہیں۔",
};
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const micSupported = useMemo(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined", []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | undefined>(undefined);
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

  /** PRD 6B: upload a recorded clip, show the transcript as the student's own message once it comes back, then
   * the verified reply -- same challenge-retry shape as deliver(), just over rpcBinary instead of rpc(). */
  async function deliverVoice(audio: ArrayBuffer, mimeType: string) {
    setTranscribing(true);
    try {
      const passHeader = (pass: string | null): Record<string, string> => (pass ? { "x-challenge-pass": pass } : {});
      const path = `/api/chat/voice?session_id=${encodeURIComponent(sessionId)}`;
      let res = await rpcBinary(path, audio, mimeType, passHeader(challengePass));
      if (res.status === 403 && (res.body as { error?: string })?.error === "challenge_required") {
        if (!config?.turnstile_site_key) {
          const pass = await requestPass(sessionId, "dev");
          res = await rpcBinary(path, audio, mimeType, passHeader(pass));
        } else {
          // A real Turnstile challenge isn't solved yet -- there's no clip queue-and-retry for voice (unlike
          // text's pendingText); the student just sees the challenge and can record again once it's solved.
          setChallengePass(null);
          return;
        }
      }
      if (res.status === 422) {
        const lang = langOverride ?? config?.default_reply_script ?? "english";
        const text = VOICE_RETRY_TEXT[lang];
        setMessages((m) => [...m, { id: uid(), role: "system", text, shown: text, language: "english" }]);
        return;
      }
      if (res.status !== 200) { setPhase("unavailable"); return; }
      const body = res.body as { transcript: string; reply: string; status: string; language: Detected; cards: FactCard[]; message_id: string | null };
      setMessages((m) => [...m, { id: uid(), role: "user", text: body.transcript, shown: body.transcript, language: body.language }]);
      handleChatResponse({ status: 200, body });
    } catch {
      setPhase("unavailable");
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    if (!micSupported || recording || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearTimeout(recordingTimerRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size > 0) await deliverVoice(await blob.arrayBuffer(), blob.type.split(";")[0] || "audio/webm");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      recordingTimerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      // NotAllowedError (denied) or NotFoundError (no mic) -- PRD 6.1: hide the mic button, typing still works.
      setMicDenied(true);
    }
  }

  function stopRecording() {
    setRecording(false);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
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
        <Header config={config} />
        <div class="uaa-unavailable">
          <p>This assistant is unavailable right now.</p>
          <p>Please contact admissions directly, or try again shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div class="uaa-root">
      <Header config={config} />
      {afterHours && <div class="uaa-banner">Our office is currently closed. I can still answer questions; staff will follow up during working hours.</div>}
      <div class="uaa-body" ref={bodyRef}>
        <WelcomeCard config={config} micSupported={micSupported && !micDenied} />
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
        <>
          {recording && <div class="uaa-recording-indicator"><span class="uaa-rec-dot" /> Recording… tap the mic to stop</div>}
          <form class="uaa-inputbar" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            {micSupported && !micDenied && (
              <button
                type="button"
                class={`uaa-mic ${recording ? "uaa-mic-active" : ""}`}
                aria-label={recording ? "Stop recording" : "Record a voice message"}
                disabled={sending || transcribing}
                onClick={() => (recording ? stopRecording() : startRecording())}
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </button>
            )}
            <input
              value={input} onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              placeholder={transcribing ? "Transcribing your voice message…" : "Ask about programs, fees, deadlines…"}
              disabled={sending || recording || transcribing}
            />
            <button type="submit" disabled={sending || recording || transcribing || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </form>
          {micDenied && <p class="uaa-mic-denied">{MIC_UNAVAILABLE_TEXT[langOverride ?? config?.default_reply_script ?? "english"]}</p>}
        </>
      )}
      <button class="uaa-handoff" onClick={handoff}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Talk to admissions staff
      </button>
    </div>
  );
}

const Sparkle = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M12 2.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9L12 2.5z" /></svg>
);

function Header({ config }: { config: TenantConfig | null }) {
  return (
    <div class="uaa-header">
      {config?.branding.logo ? <img src={config.branding.logo} alt="" class="uaa-logo" /> : (
        <div class="uaa-logo uaa-logo-fallback"><Sparkle size={18} /></div>
      )}
      <div class="uaa-header-text">
        <div class="uaa-header-name">{config?.name ?? "Admissions"}</div>
        <div class="uaa-header-badge">AI Admissions Assistant</div>
      </div>
      <button class="uaa-close" aria-label="Close" onClick={() => tellParent({ channel: "uaa-widget", type: "close" } as never)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
  );
}

function WelcomeCard({ config, micSupported }: { config: TenantConfig | null; micSupported: boolean }) {
  if (!config) return null;
  return (
    <div class="uaa-welcome">
      <div>
        <div class="uaa-welcome-title">Welcome to {config.name}</div>
        <p class="uaa-welcome-text">{config.welcome_message}</p>
        {/* PRD 6B: "The first-open notice says voice recordings are transcribed and not kept." */}
        {micSupported && <p class="uaa-welcome-voice-notice">🎙️ You can also ask by voice — recordings are transcribed and not kept.</p>}
      </div>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
