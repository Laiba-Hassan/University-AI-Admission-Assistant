import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { rpc, rpcBinary, tellParent, waitForInit } from "./rpc.js";
import { isWithinWorkingHours } from "./working-hours.js";

// PRD 6B: "about 2 minutes per recording" -- stop automatically a little under the server's own MAX_VOICE_SECONDS
// (125s) so a clip is never silently rejected purely for running a few seconds past the client's own guess at it.
const MAX_RECORDING_MS = 120_000;
const VOICE_RETRY_TEXT = {
  english: "Sorry, I couldn't quite make that out. Try recording again, or type your question instead.",
  roman_urdu: "Maazrat, mujhe woh sunai nahi diya. Dobara record karein ya apna sawal type kar dein.",
  urdu: "معذرت، مجھے وہ سنائی نہیں دیا۔ دوبارہ ریکارڈ کریں یا اپنا سوال لکھ دیں۔"
};
const MIC_UNAVAILABLE_TEXT = {
  english: "Microphone access was denied. You can still type your question below.",
  roman_urdu: "Mic ki ijazat nahi mili. Aap neeche apna sawal type kar sakte hain.",
  urdu: "مائیک کی اجازت نہیں ملی۔ آپ نیچے اپنا سوال لکھ سکتے ہیں۔"
};
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
}
const LANG_LABEL = {
  english: "English",
  roman_urdu: "Roman Urdu",
  urdu: "اردو"
};
const uid = () => Math.random().toString(36).slice(2, 10);

/** Cosmetic word-by-word reveal of an ALREADY-verified reply (verification happens server-side before anything is
 * sent to the widget at all -- this only paces how it appears, per PRD 6.1 "verified, then revealed progressively"). */
function useTypewriter(setMessages) {
  return (id, fullText) => {
    const words = fullText.split(" ");
    let i = 0;
    const step = () => {
      i++;
      const shown = words.slice(0, i).join(" ");
      setMessages(msgs => msgs.map(m => m.id === id ? {
        ...m,
        shown
      } : m));
      if (i < words.length) setTimeout(step, 18 + Math.random() * 22);
    };
    step();
  };
}
function App() {
  const key = new URLSearchParams(location.search).get("key") ?? "";
  const [phase, setPhase] = useState("loading");
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [langOverride, setLangOverride] = useState(null);
  const [challengePass, setChallengePass] = useState(null);
  const [sessionId, setSessionId] = useState("");
  const [afterHours, setAfterHours] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [waveLevels, setWaveLevels] = useState([0, 0, 0, 0, 0]);
  const micSupported = useMemo(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined", []);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingTimerRef = useRef(undefined);
  const audioCtxRef = useRef(null);
  const waveRafRef = useRef(undefined);
  const bodyRef = useRef(null);
  const turnstileRef = useRef(null);
  const lastSeenRef = useRef(null); // ISO timestamp cursor for the poll loop below
  // Belt-and-suspenders against the cursor alone: a hidden cross-origin iframe's timers can get throttled by the
  // browser and then fire several backlogged ticks in a burst once it regains attention, which can re-request the
  // same "since" value more than once before the first response has updated the cursor. Tracking seen message ids
  // makes appending/counting idempotent regardless of how many times a response happens to repeat.
  const seenIdsRef = useRef(new Set());
  const reveal = useTypewriter(setMessages);
  function toLocalMessage(row) {
    return {
      id: row.id,
      role: row.role === "staff" ? "assistant" : row.role,
      fromStaff: row.role === "staff",
      text: row.content,
      shown: row.content,
      language: row.language ?? "english",
      cards: row.cards ?? [],
      messageId: row.role === "assistant" ? row.id : undefined
    };
  }
  useEffect(() => {
    (async () => {
      const {
        sessionId: sid
      } = await waitForInit();
      setSessionId(sid);
      const cfgRes = await rpc("/api/widget/config", "GET");
      if (cfgRes.status !== 200) {
        setPhase("unavailable");
        return;
      }
      const cfg = cfgRes.body;
      setConfig(cfg);
      // The dashboard only exposes one color picker (branding.accent) -- it drives --uaa-primary, the variable
      // actually used everywhere (header, buttons, bubbles, mic, chips), not the old --uaa-primary <- branding.primary
      // wiring, which read a field the dashboard never writes and left the picker with almost no visible effect.
      document.documentElement.style.setProperty("--uaa-primary", cfg.branding.accent ?? "#0B3D91");
      document.documentElement.style.setProperty("--uaa-accent", cfg.branding.accent ?? "#F2A900");
      setAfterHours(isWithinWorkingHours(cfg.working_hours) === false);
      setPhase("ready");

      // Resume: loader.js already persists this session_id in localStorage per widget key, so a returning visitor
      // (same browser, same site) gets the SAME conversation back -- show them what they already said plus
      // anything staff replied while they were gone, instead of starting blank every page load.
      const histRes = await rpc(`/api/widget/messages?session_id=${encodeURIComponent(sid)}`, "GET");
      if (histRes.status === 200 && histRes.body.messages.length) {
        const rows = histRes.body.messages;
        rows.forEach(r => seenIdsRef.current.add(r.id));
        setMessages(rows.map(toLocalMessage));
        lastSeenRef.current = rows[rows.length - 1].timestamp;
      } else {
        lastSeenRef.current = new Date().toISOString();
      }

      // No Cloudflare site key configured (local/dev): the backend's own dev bypass ignores the token value, so a
      // placeholder is enough to get a pass. With a real site key, the widget waits for the visitor to complete it.
      if (!cfg.turnstile_site_key) requestPass(sid, "dev");
    })();
  }, []);
  // Poll for anything new since the last message we know about -- a staff reply typed from the Inbox while this
  // tab was sitting minimized/closed. Keeps running even while the panel is visually hidden (the iframe itself is
  // never torn down, loader.js just hides it with CSS), which is exactly the case this needs to cover.
  useEffect(() => {
    if (!sessionId) return;
    const id = window.setInterval(async () => {
      const res = await rpc(`/api/widget/messages?session_id=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(lastSeenRef.current)}`, "GET");
      if (res.status !== 200 || !res.body.messages.length) return;
      lastSeenRef.current = res.body.messages[res.body.messages.length - 1].timestamp;
      const rows = res.body.messages.filter(r => !seenIdsRef.current.has(r.id));
      if (!rows.length) return;
      rows.forEach(r => seenIdsRef.current.add(r.id));
      setMessages(m => [...m, ...rows.map(toLocalMessage)]);
      const newReplies = rows.filter(r => r.role !== "user").length;
      if (newReplies > 0) tellParent({
        channel: "uaa-widget",
        type: "unread",
        count: newReplies
      });
    }, 6000);
    return () => window.clearInterval(id);
  }, [sessionId]);
  useEffect(() => {
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);
  useEffect(() => {
    tellParent({
      channel: "uaa-widget",
      type: "resize",
      height: document.body.scrollHeight
    });
  }, [messages, phase, challengePass]);

  // Real Cloudflare Turnstile, only when the tenant's config actually carries a site key. Loads the widget script
  // once and renders the challenge into turnstileRef; its callback supplies the token requestPass needs.
  useEffect(() => {
    if (!config?.turnstile_site_key || challengePass) return;
    const w = window;
    const mount = () => w.turnstile?.render(turnstileRef.current, {
      sitekey: config.turnstile_site_key,
      callback: token => requestPass(sessionId, token)
    });
    if (w.turnstile) {
      mount();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.onload = mount;
    document.head.appendChild(script);
  }, [config, sessionId, challengePass]);
  async function requestPass(sid, token) {
    const res = await rpc("/api/widget/session", "POST", {
      session_id: sid,
      turnstile_token: token
    });
    if (res.status !== 200) return null;
    const pass = res.body.challenge_pass;
    setChallengePass(pass); // for future turns; the CALLER still uses the returned value for this one (state updates are async)
    return pass;
  }
  const [pendingText, setPendingText] = useState(null);

  // A pass obtained AFTER a message was queued (real Turnstile, completed mid-flow): send it now, once.
  useEffect(() => {
    if (challengePass && pendingText) {
      const text = pendingText;
      setPendingText(null);
      void deliver(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengePass]);

  /** The actual network call + response handling, separate from send() so a queued retry never re-appends the
   * user's bubble a second time. */
  async function deliver(value) {
    setSending(true);
    try {
      const chatBody = {
        message: value,
        session_id: sessionId,
        ...(langOverride ? {
          language: langOverride
        } : {})
      };
      const passHeader = pass => pass ? {
        "x-challenge-pass": pass
      } : {};
      const res = await rpc("/api/chat", "POST", chatBody, passHeader(challengePass));
      if (res.status === 403 && res.body?.error === "challenge_required") {
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
  function handleChatResponse(res) {
    if (res.status !== 200) {
      setPhase("unavailable");
      return;
    }
    const body = res.body;
    // The server's own timestamp for this reply, not the client's clock -- using Date.now() here raced the poll
    // loop's "since" cursor against real clock skew and double-counted the very message just shown live.
    if (body.timestamp) lastSeenRef.current = body.timestamp;
    if (body.message_id) seenIdsRef.current.add(body.message_id);
    if (body.status === "human") return; // staff has taken over; stay silent
    const botId = uid();
    setMessages(m => [...m, {
      id: botId,
      role: "assistant",
      text: body.reply,
      shown: "",
      language: body.language,
      cards: body.cards,
      messageId: body.message_id
    }]);
    reveal(botId, body.reply);
  }
  async function send(text) {
    const value = text.trim();
    if (!value || sending || !config) return;
    setInput("");
    setMessages(m => [...m, {
      id: uid(),
      role: "user",
      text: value,
      shown: value,
      language: langOverride ?? "english"
    }]);
    lastSeenRef.current = new Date().toISOString(); // keep the poll loop's cursor from re-fetching what we just showed live
    await deliver(value);
  }

  /** PRD 6B: upload a recorded clip, show the transcript as the student's own message once it comes back, then
   * the verified reply -- same challenge-retry shape as deliver(), just over rpcBinary instead of rpc(). */
  async function deliverVoice(audio, mimeType) {
    setTranscribing(true);
    try {
      const passHeader = pass => pass ? {
        "x-challenge-pass": pass
      } : {};
      const path = `/api/chat/voice?session_id=${encodeURIComponent(sessionId)}`;
      let res = await rpcBinary(path, audio, mimeType, passHeader(challengePass));
      if (res.status === 403 && res.body?.error === "challenge_required") {
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
        setMessages(m => [...m, {
          id: uid(),
          role: "system",
          text,
          shown: text,
          language: "english"
        }]);
        return;
      }
      if (res.status !== 200) {
        setPhase("unavailable");
        return;
      }
      const body = res.body;
      setMessages(m => [...m, {
        id: uid(),
        role: "user",
        text: body.transcript,
        shown: body.transcript,
        language: body.language
      }]);
      handleChatResponse({
        status: 200,
        body
      });
    } catch {
      setPhase("unavailable");
    } finally {
      setTranscribing(false);
    }
  }
  // Real mic-level meter, not a canned loop -- 5 bars read live frequency data so they sit flat during silence
  // and move with actual speech, the same cue WhatsApp's voice-note recorder gives.
  function startWaveMeter(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser); // analyser is never connected to destination -- this must stay silent, not echo the mic
    audioCtxRef.current = ctx;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const BARS = 5;
    const bucket = Math.floor(data.length / BARS) || 1;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const next = [];
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = i * bucket; j < (i + 1) * bucket; j++) sum += data[j];
        next.push(Math.max(0.1, Math.min(1, sum / bucket / 255 * 1.8)));
      }
      setWaveLevels(next);
      waveRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopWaveMeter() {
    if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current);
    waveRafRef.current = undefined;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setWaveLevels([0, 0, 0, 0, 0]);
  }
  async function startRecording() {
    if (!micSupported || recording || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      startWaveMeter(stream);
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, {
        mimeType
      }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        window.clearTimeout(recordingTimerRef.current);
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm"
        });
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
    stopWaveMeter();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }
  async function rate(msg, rating) {
    if (!msg.messageId) return;
    setMessages(m => m.map(x => x.id === msg.id ? {
      ...x,
      rating
    } : x));
    await rpc("/api/chat/feedback", "POST", {
      message_id: msg.messageId,
      rating
    });
  }
  const chips = useMemo(() => config?.suggested_questions.slice(0, 4) ?? [], [config]);
  if (phase === "loading") return <div class="uaa-center"><div class="uaa-spinner" /></div>;
  if (phase === "unavailable") {
    return <div class="uaa-root">
        <Header config={config} />
        <div class="uaa-unavailable">
          <p>This assistant is unavailable right now.</p>
          <p>Please contact admissions directly, or try again shortly.</p>
        </div>
      </div>;
  }
  return <div class="uaa-root">
      <Header config={config} />
      {afterHours && <div class="uaa-banner">Our office is currently closed. I can still answer questions; staff will follow up during working hours.</div>}
      <div class="uaa-body" ref={bodyRef}>
        <WelcomeCard config={config} />
        {messages.map(m => <div key={m.id} class={`uaa-row uaa-row-${m.role}`}>
            {m.fromStaff && <div class="uaa-staff-label">Admissions staff</div>}
            <div class={`uaa-bubble uaa-bubble-${m.role}`} dir={m.language === "urdu" ? "rtl" : "ltr"}>
              {m.shown}
              {m.role === "assistant" && m.shown !== m.text && <span class="uaa-cursor" />}
            </div>
            {m.cards?.map((c, i) => <div key={i} class={`uaa-card ${c.stale ? "uaa-card-stale" : ""}`}>
                <div class="uaa-card-label">{c.label}</div>
                <div class="uaa-card-value">{c.value}</div>
                {c.as_of && <div class="uaa-card-asof">as of {c.as_of}{c.stale ? " (may be outdated)" : ""}</div>}
              </div>)}
            {m.role === "assistant" && m.messageId && m.shown === m.text && <div class="uaa-thumbs">
                <button aria-label="Helpful" class={m.rating === 1 ? "uaa-thumb-active" : ""} onClick={() => rate(m, 1)}>👍</button>
                <button aria-label="Not helpful" class={m.rating === -1 ? "uaa-thumb-active" : ""} onClick={() => rate(m, -1)}>👎</button>
              </div>}
          </div>)}
        {sending && <div class="uaa-row uaa-row-assistant"><div class="uaa-bubble uaa-typing"><span /><span /><span /></div></div>}
      </div>
      {chips.length > 0 && !sending && messages.length === 0 && <div class="uaa-chips">{chips.map(q => <button key={q} class="uaa-chip" onClick={() => send(q)}>{q}</button>)}</div>}
      <div class="uaa-langbar">
        {["english", "roman_urdu", "urdu"].map(l => <button key={l} class={`uaa-lang ${langOverride === l ? "uaa-lang-active" : ""}`} onClick={() => setLangOverride(l)}>{LANG_LABEL[l]}</button>)}
      </div>
      {config?.turnstile_site_key && !challengePass ? <div class="uaa-turnstile-wrap">
          <p>Please complete the check below to continue.</p>
          <div ref={turnstileRef} />
        </div> : <>
          {recording && <div class="uaa-recording-indicator"><span class="uaa-wave">{waveLevels.map((lvl, i) => <span key={i} class="uaa-wave-bar" style={{
          height: `${4 + lvl * 14}px`
        }} />)}</span> Recording… tap the mic to stop</div>}
          <form class="uaa-inputbar" onSubmit={e => {
        e.preventDefault();
        send(input);
      }}>
            <input value={input} onInput={e => setInput(e.target.value)} placeholder={transcribing ? "Transcribing your voice message…" : "Ask about programs, fees, deadlines…"} disabled={sending || recording || transcribing} />
            {micSupported && !micDenied && <button type="button" class={`uaa-mic ${recording ? "uaa-mic-active" : ""}`} aria-label={recording ? "Stop recording" : "Record a voice message"} disabled={sending || transcribing} onClick={() => recording ? stopRecording() : startRecording()}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </button>}
            <button type="submit" disabled={sending || recording || transcribing || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </form>
          {micDenied && <p class="uaa-mic-denied">{MIC_UNAVAILABLE_TEXT[langOverride ?? config?.default_reply_script ?? "english"]}</p>}
        </>}
    </div>;
}
const Sparkle = ({
  size = 16
}) => <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M12 2.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9L12 2.5z" /></svg>;
function Header({
  config
}) {
  return <div class="uaa-header">
      {config?.branding.logo ? <img src={config.branding.logo} alt="" class="uaa-logo" /> : <div class="uaa-logo uaa-logo-fallback"><Sparkle size={18} /></div>}
      <div class="uaa-header-text">
        <div class="uaa-header-name">{config?.name ?? "Admissions"}</div>
        <div class="uaa-header-badge">AI Admissions Assistant</div>
      </div>
      <button class="uaa-close" aria-label="Close" onClick={() => tellParent({
      channel: "uaa-widget",
      type: "close"
    })}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>;
}
function WelcomeCard({
  config
}) {
  if (!config) return null;
  return <div class="uaa-welcome">
      <div>
        <div class="uaa-welcome-title">Welcome to {config.name}</div>
        <p class="uaa-welcome-text">{config.welcome_message}</p>
      </div>
    </div>;
}
render(<App />, document.getElementById("app"));