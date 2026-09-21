// Code-enforced verification (PRD Section 5). Guardrails are not prompt-only: every currency amount, date and
// percentage in a generated reply must be SUPPORTED by this turn's evidence, or the reply is discarded.
//   amounts and dates : lookup_facts results of this turn, or the student's own words
//   percentages       : lookup_facts results, an approved retrieved chunk, or the student's own words
// Extraction normalises Urdu digits, thousands separators, "lakh/hazar/k" multipliers and English spoken numbers, so a
// model cannot slip a figure past the check by rewriting it.

export interface Figure { kind: "amount" | "percent" | "date"; value: number | string; raw: string }
export interface Evidence { facts: unknown[]; chunks: string[]; userTexts: string[] }
export interface Verdict { ok: boolean; unsupported: Figure[] }

// ---------------------------------------------------------------- normalisation
const EASTERN_DIGITS: Record<string, string> = {};
"۰۱۲۳۴۵۶۷۸۹".split("").forEach((d, i) => (EASTERN_DIGITS[d] = String(i)));   // Extended Arabic-Indic (Urdu)
"٠١٢٣٤٥٦٧٨٩".split("").forEach((d, i) => (EASTERN_DIGITS[d] = String(i)));   // Arabic-Indic
export const normaliseDigits = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => EASTERN_DIGITS[d]!).replace(/[٬،]/g, ",").replace(/٫/g, ".");

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  جنوری: 1, فروری: 2, مارچ: 3, اپریل: 4, مئی: 5, جون: 6, جولائی: 7, اگست: 8, ستمبر: 9, اکتوبر: 10, نومبر: 11, دسمبر: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Roman Urdu / Urdu spoken units commonly used with lakh/hazar
  ek: 1, aik: 1, ایک: 1, do: 2, دو: 2, teen: 3, تین: 3, char: 4, chaar: 4, چار: 4, panch: 5, paanch: 5, پانچ: 5, chay: 6, chhe: 6, چھ: 6,
  saat: 7, سات: 7, aath: 8, آٹھ: 8, nau: 9, نو: 9, das: 10, دس: 10, pachas: 50, پچاس: 50, sau: 100, سو: 100,
};
const MULTIPLIERS: Record<string, number> = {
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, لاکھ: 1e5, hazar: 1e3, hazaar: 1e3, hazār: 1e3, ہزار: 1e3, thousand: 1e3, k: 1e3,
  million: 1e6, crore: 1e7, karor: 1e7, کروڑ: 1e7, hundred: 100,
};
const NUM_WORD_RE = Object.keys(UNITS).sort((a, b) => b.length - a.length).join("|");

/** "one hundred eighty-five thousand" -> 185000. Returns undefined if the phrase is not a plain number phrase. */
export function wordsToNumber(phrase: string): number | undefined {
  const words = phrase.toLowerCase().replace(/-/g, " ").replace(/\band\b/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  let total = 0, current = 0, seen = false;
  for (const w of words) {
    if (w in UNITS) { current += UNITS[w]!; seen = true; }
    else if (w in MULTIPLIERS) {
      const m = MULTIPLIERS[w]!;
      if (m === 100) current = (current || 1) * 100;
      else { total += (current || 1) * m; current = 0; }
      seen = true;
    } else return undefined;
  }
  return seen ? total + current : undefined;
}

const num = (s: string) => Number(s.replace(/,/g, ""));
const isYear = (n: number, raw: string) => Number.isInteger(n) && n >= 1900 && n <= 2100 && !/[,.]/.test(raw);
const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- extraction
export function extractFigures(input: string): Figure[] {
  let text = normaliseDigits(input).toLowerCase();
  const out: Figure[] = [];
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => Figure | undefined) => {
    text = text.replace(re, (...args) => {
      const groups = args.slice(0, -2) as string[];
      const m = Object.assign(groups, { index: 0 }) as unknown as RegExpMatchArray;
      const f = fn(m);
      if (f) out.push(f);
      return f ? " " : groups[0]!;
    });
  };

  // Dates. Value "MM-DD" (year optional: "YYYY-MM-DD" when present).
  const date = (mo: number, d: number, y?: string, raw = ""): Figure | undefined =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { kind: "date", value: y ? `${y}-${pad(mo)}-${pad(d)}` : `${pad(mo)}-${pad(d)}`, raw } : undefined;
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => date(+m[2]!, +m[3]!, m[1], m[0]));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})(?![a-z\\u0600-\\u06ff])\\.?,?(?:\\s+(\\d{4}))?`, "g"), (m) => date(MONTHS[m[2]!]!, +m[1]!, m[3], m[0]));
  take(new RegExp(`(?<![a-z\\u0600-\\u06ff])(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s+(\\d{4}))?`, "g"), (m) => date(MONTHS[m[1]!]!, +m[2]!, m[3], m[0]));
  take(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g, (m) => date(+m[2]!, +m[1]!, m[3], m[0])); // day-first

  // Percentages (digits, then English number words).
  take(/(\d+(?:\.\d+)?)\s*(?:%|percent|percentage|فیصد|pratishat|fisad|fi\s?sad)/g, (m) => ({ kind: "percent", value: num(m[1]!), raw: m[0] }));
  take(new RegExp(`(?<![a-z])((?:(?:${NUM_WORD_RE})[\\s-]*)+)\\s*(?:percent|فیصد)`, "g"), (m) => {
    const n = wordsToNumber(m[1]!);
    return n === undefined ? undefined : { kind: "percent", value: n, raw: m[0] };
  });

  // Multiplied amounts: "1.85 lakh", "185k", "ek lakh 85 hazar", "one hundred eighty five thousand".
  // Token scan: a run of number tokens (digits / number words / multipliers) that contains a multiplier.
  {
    const parts: { start: number; end: number; tok: string }[] = [];
    for (const m of text.matchAll(/\S+/g)) parts.push({ start: m.index!, end: m.index! + m[0].length, tok: m[0].replace(/[.,;:!?()]+$/g, "") });
    const kind = (t: string) => (/^\d[\d,]*(?:\.\d+)?$/.test(t) ? "digit" : /^\d+(?:\.\d+)?k$/.test(t) ? "digitk" : t.split("-").every((p) => p in UNITS) ? "word" : t in MULTIPLIERS ? "mult" : t === "and" ? "and" : "");
    const blank: [number, number][] = [];
    for (let i = 0; i < parts.length; i++) {
      const k = kind(parts[i]!.tok);
      if (k !== "digit" && k !== "digitk" && k !== "word") continue;
      let total = 0, coeff = 0, sawMult = false, j = i, last = i;
      for (; j < parts.length; j++) {
        const t = parts[j]!.tok, kk = kind(t);
        if (kk === "digit") coeff += num(t);
        else if (kk === "digitk") { total += num(t.slice(0, -1)) * 1e3; sawMult = true; }
        else if (kk === "word") coeff += t.split("-").reduce((a, p) => a + UNITS[p]!, 0);
        else if (kk === "mult" && coeff > 0) {
          const mult = MULTIPLIERS[t]!;
          if (mult === 100) coeff *= 100; else { total += coeff * mult; coeff = 0; sawMult = true; }
        } else if (kk === "and" && j + 1 < parts.length && ["digit", "word"].includes(kind(parts[j + 1]!.tok))) continue;
        else break;
        last = j;
      }
      if (sawMult) {
        out.push({ kind: "amount", value: Math.round((total + coeff) * 100) / 100, raw: text.slice(parts[i]!.start, parts[last]!.end) });
        blank.push([parts[i]!.start, parts[last]!.end]);
      }
      i = Math.max(i, last);
    }
    for (const [a, b] of blank.reverse()) text = text.slice(0, a) + " ".repeat(b - a) + text.slice(b);
  }

  // English spoken numbers without a multiplier are not flagged unless >= 1000 (handled above); plain digits next:
  // Word boundaries matter: "hou[rs.]" at the end of "credit hours." must not read as "Rs."
  const CURRENCY_NEAR = /(?<![a-z])(?:pkr|rs\.?|rupees?|روپے|usd|\$|dollars?|ڈالر)\s*$|^\s*(?:pkr|rs\.?|rupees?|روپے|usd|dollars?|ڈالر|\/-)(?![a-z])/;
  const re = /\d[\d,]*(?:\.\d+)?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0].replace(/[,.]$/, "");
    const n = num(raw);
    if (Number.isNaN(n) || isYear(n, raw)) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    const currency = CURRENCY_NEAR.test(before) || CURRENCY_NEAR.test(after);
    const perUnit = /^\s*(?:\/|per\b|فی)/.test(after);
    if (n >= 1000 || currency || perUnit) out.push({ kind: "amount", value: n, raw });
  }
  return out;
}

// ---------------------------------------------------------------- evidence
/** Every number and ISO date appearing anywhere in a structured tool result. */
function walk(value: unknown, sink: { numbers: Set<number>; dates: Set<string> }) {
  if (typeof value === "number") sink.numbers.add(value);
  else if (typeof value === "string") {
    for (const f of extractFigures(value)) {
      if (f.kind === "date") sink.dates.add(String(f.value));
      else sink.numbers.add(Number(f.value));
    }
    for (const m of normaliseDigits(value).matchAll(/\d[\d,]*(?:\.\d+)?/g)) sink.numbers.add(num(m[0]));
  } else if (Array.isArray(value)) value.forEach((v) => walk(v, sink));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, sink));
}

const dateKeys = (v: string) => (v.length === 10 ? [v, v.slice(5)] : [v]);

export function verifyReply(reply: string, evidence: Evidence): Verdict {
  const facts = { numbers: new Set<number>(), dates: new Set<string>() };
  walk(evidence.facts, facts);
  const user = { numbers: new Set<number>(), dates: new Set<string>() };
  for (const t of evidence.userTexts) {
    walk(t, user);
    for (const m of normaliseDigits(t).matchAll(/\d[\d,]*(?:\.\d+)?/g)) user.numbers.add(num(m[0]));
  }
  const rag = { numbers: new Set<number>(), dates: new Set<string>() };
  for (const c of evidence.chunks) walk(c, rag);

  const supportedDate = (v: string) => {
    const pool = new Set([...facts.dates, ...user.dates]);
    const poolShort = new Set([...pool].flatMap(dateKeys));
    return dateKeys(v).some((k) => poolShort.has(k)) || pool.has(v);
  };

  const unsupported: Figure[] = [];
  for (const f of extractFigures(reply)) {
    let ok: boolean;
    if (f.kind === "date") ok = supportedDate(String(f.value));
    else if (f.kind === "percent") ok = [facts, user, rag].some((s) => s.numbers.has(Number(f.value)));
    else ok = [facts, user].some((s) => s.numbers.has(Number(f.value)));
    if (!ok) unsupported.push(f);
  }
  return { ok: unsupported.length === 0, unsupported };
}
