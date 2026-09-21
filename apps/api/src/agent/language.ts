// Language and script detection for the three supported reply languages (PRD "Language Rules").
// Deterministic and code-side: the agent is TOLD which language to reply in, and the eval checks the reply against
// the same detector. Matching Roman Urdu is lexicon-based because it has no standard spelling.

export type Lang = "urdu" | "roman_urdu" | "english";
export type Detected = Lang | "other";

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const OTHER_SCRIPTS = /[ऀ-ॿЀ-ӿ一-鿿぀-ヿ가-힯ঀ-৿฀-๿]/g;

// Distinctive Roman Urdu function words and common spelling variants. Words that are also common English words
// (e.g. "main", "to", "me") are deliberately left out.
const ROMAN_URDU = new Set((
  "hai hain hy hn h tha thi ho hoga hogi hota hoti hote kya kia kiya kyun kion kyon kaise kese kesay kaisay kahan kahaan kidhar " +
  "kab kitni kitna kitne kon kaun kis ka ki ke ko mein mai mujhe mujhay mera meri mere hum hamara aap ap aapka aapki apka apki " +
  "tum tumhara nahi nahin nhi na sakta sakti sakte sakhta chahiye chahye chahyay chahta chahti karna karni karein karen kar karo " +
  "kare karun karu karta karti lagta lagti lagana milta milti milte milegi milega mil dena dein dain diya batao batayen bataye " +
  "bataen bata btao btaen janna jaanna jana jani jaye jayen wala wali wale aur lekin magar bhi bhe se tak liye liya " +
  "larkiyon larkion larkay larkon ghar abhi ab phir fir kal aaj shukriya shukria meherbani ji jee acha accha theek thik " +
  "tareekh tarikh akhri aakhri qist qiston qisto fiss paisay paise rupay rupaye scolarship scholarhip wazifa " +
  "admishan dakhla dakhlay dakhle taleem parhai parhna parhne kahan yahan wahan sab kuch koi kam zyada zayada " +
  "bohat bahut bohot thora thoda pehle pehla baad saath sath uske iske unka inka isliye kyunke kyunki agar hoon hun " +
  "hu rehna rehte rehti raha rahi rahe rahay lag ga gi gay gey"
).split(/\s+/).filter(Boolean));

const tokens = (text: string) => text.toLowerCase().match(/[a-z']+/g) ?? [];

/**
 * Detect the language of one message. Returns undefined for messages too short or neutral to judge (a bare number, a
 * program code like "BSCS", "ok"): the caller then keeps the conversation's current language.
 */
export function detectLanguage(text: string): Detected | undefined {
  const arabic = (text.match(ARABIC_SCRIPT) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  const other = (text.match(OTHER_SCRIPTS) ?? []).length;
  if (other > arabic && other > latin) return "other";
  // Word-level, not letter-level: an Urdu sentence that keeps program names and terms in English ("BSCS", "tuition fee")
  // has many Latin letters but is still Urdu. Urdu-script words are >= 30% of all words -> Urdu.
  const urduWords = (text.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-z]+/g) ?? []).length;
  if (urduWords > 0 && (arabic >= latin || urduWords >= 0.3 * (urduWords + latinWords))) return "urdu";

  const words = tokens(text);
  if (!words.length) return undefined;
  const hits = words.filter((w) => ROMAN_URDU.has(w)).length;
  if (hits >= 2 || (hits >= 1 && hits / words.length >= 0.25)) return "roman_urdu";
  if (words.length <= 2) return undefined; // "BSCS", "ok", "fees" -> keep the conversation language
  return "english";
}

/** Language to reply in: this message if detectable, else the conversation's, else the tenant default. */
export function replyLanguage(current: string, previous: Detected | undefined, tenantDefault: Lang): Detected {
  return detectLanguage(current) ?? previous ?? tenantDefault;
}
