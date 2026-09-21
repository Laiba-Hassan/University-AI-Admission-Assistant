// PII masking applied to message text BEFORE it is stored (PRD Section 11): national ID numbers, payment cards,
// phone numbers and email addresses. The model still sees the original text for the turn it was sent in (so a lead can
// be captured), but only the masked form is persisted and replayed as history.

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

export function maskPii(text: string): { text: string; masked: string[] } {
  const masked: string[] = [];
  const hit = (kind: string, replacement: string) => { masked.push(kind); return replacement; };
  let out = text;

  // Pakistani CNIC: 12345-1234567-1 (dashes optional, 13 digits). Checked before phone numbers.
  out = out.replace(/\b\d{5}[- ]?\d{7}[- ]?\d\b/g, () => hit("national_id", "[ID NUMBER]"));
  // Payment cards: 13-19 digits, optionally grouped, and passing the Luhn check (so ordinary numbers are left alone).
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? hit("card", "[CARD NUMBER]") : m));
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => hit("email", "[EMAIL]"));
  // Phones: +92 300 1234567, 0300-1234567, 03001234567, (10-13 digits with optional separators).
  out = out.replace(/(?<![\w.])(?:\+?92|0)[\s-]?3\d{2}[\s-]?\d{7}(?!\d)/g, () => hit("phone", "[PHONE]"));
  out = out.replace(/(?<![\w.,])\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}(?![\w,]|\.\d)/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13 && /^\+|\s|-|\(/.test(m) ? hit("phone", "[PHONE]") : m;
  });
  return { text: out, masked };
}
