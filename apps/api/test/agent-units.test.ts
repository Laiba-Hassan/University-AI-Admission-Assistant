import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskPii } from "../src/agent/pii.js";
import { detectLanguage, replyLanguage } from "../src/agent/language.js";
import { extractFigures, verifyReply, wordsToNumber } from "../src/agent/verifier.js";

const facts = [{ amount: 185000, currency: "PKR", per: "semester", last_verified_at: "2026-08-01", application_deadline: "2026-10-15", days_remaining: 24 }];
const check = (reply: string, userTexts: string[] = [], chunks: string[] = []) => verifyReply(reply, { facts, chunks, userTexts });

describe("PII masking", () => {
  it("masks CNIC numbers with and without dashes", () => {
    assert.equal(maskPii("my cnic is 35202-1234567-1 ok").text, "my cnic is [ID NUMBER] ok");
    assert.equal(maskPii("3520212345671").text, "[ID NUMBER]");
  });
  it("masks Luhn-valid card numbers but leaves ordinary numbers alone", () => {
    assert.equal(maskPii("card 4111 1111 1111 1111").text, "card [CARD NUMBER]");
    assert.equal(maskPii("fee is 185000 PKR").text, "fee is 185000 PKR");
    assert.equal(maskPii("total 1234567890123").masked.includes("card"), false);
  });
  it("masks Pakistani phone numbers and emails", () => {
    assert.equal(maskPii("call 0300-1234567 please").text, "call [PHONE] please");
    assert.equal(maskPii("+92 300 1234567").text, "[PHONE]");
    assert.equal(maskPii("03001234567").text, "[PHONE]");
    assert.equal(maskPii("mail me at ali.khan@example.com").text, "mail me at [EMAIL]");
  });
  it("does not mask fees, years or credit hours", () => {
    for (const t of ["PKR 185,000 per semester", "intake 2026-27", "133 credit hours", "12,500 per credit hour", "deadline 2026-10-15"])
      assert.equal(maskPii(t).text, t);
  });
});

describe("language detection", () => {
  it("detects the three supported languages", () => {
    assert.equal(detectLanguage("What is the fee for BSCS at the Lahore campus?"), "english");
    assert.equal(detectLanguage("BSCS ki fees kitni hai Lahore campus mein?"), "roman_urdu");
    assert.equal(detectLanguage("لاہور کیمپس میں بی ایس سی ایس کی فیس کتنی ہے؟"), "urdu");
  });
  it("handles Roman Urdu spelling variants and chat style", () => {
    assert.equal(detectLanguage("scolarship kesay milti he"), "roman_urdu");
    assert.equal(detectLanguage("admishan ki akhri tareekh kya hai"), "roman_urdu");
    assert.equal(detectLanguage("fee kitni bscs ki"), "roman_urdu");
    assert.equal(detectLanguage("do u have evening classes"), "english");
  });
  it("returns undefined for neutral short messages so the conversation language is kept", () => {
    for (const t of ["BSCS", "ok", "85", "yes"]) assert.equal(detectLanguage(t), undefined);
    assert.equal(replyLanguage("BSCS", "urdu", "english"), "urdu");
    assert.equal(replyLanguage("ok", undefined, "roman_urdu"), "roman_urdu");
  });
  it("treats an Urdu sentence with English program names and terms as Urdu", () => {
    assert.equal(detectLanguage("Islamabad Campus میں local طالب علم کے لیے BSAI کی tuition fee PKR 215,000 فی semester ہے۔"), "urdu");
    assert.equal(detectLanguage("Lahore Main Campus میں hostel کی فیس PKR 65,000 فی semester ہے۔"), "urdu");
    assert.equal(detectLanguage("What is the fee for BSCS? شکریہ"), "english");
  });
  it("flags other scripts", () => {
    assert.equal(detectLanguage("मुझे फीस बताइए"), "other");
  });
});

describe("verifier: figure extraction", () => {
  const vals = (s: string) => extractFigures(s).map((f) => `${f.kind}:${f.value}`);
  it("extracts amounts with separators and currency", () => {
    assert.deepEqual(vals("The fee is PKR 185,000 per semester"), ["amount:185000"]);
    assert.deepEqual(vals("Rs. 500"), ["amount:500"]);
    assert.deepEqual(vals("fee 12,500 per credit hour"), ["amount:12500"]);
  });
  it("normalises Urdu digits", () => {
    assert.deepEqual(vals("فیس ۱۸۵,۰۰۰ روپے ہے"), ["amount:185000"]);
    assert.deepEqual(vals("١٨٥٠٠٠ PKR"), ["amount:185000"]);
  });
  it("normalises lakh / hazar / k multipliers and spoken numbers", () => {
    assert.deepEqual(vals("1.85 lakh"), ["amount:185000"]);
    assert.deepEqual(vals("185k"), ["amount:185000"]);
    assert.deepEqual(vals("ek lakh 85 hazar"), ["amount:185000"]);
    assert.deepEqual(vals("one hundred eighty five thousand rupees"), ["amount:185000"]);
    assert.equal(wordsToNumber("one hundred eighty-five thousand"), 185000);
  });
  it("extracts dates in several formats", () => {
    assert.deepEqual(vals("deadline is 2026-10-15"), ["date:2026-10-15"]);
    assert.deepEqual(vals("apply by 15 October 2026"), ["date:2026-10-15"]);
    assert.deepEqual(vals("apply by October 15th"), ["date:10-15"]);
    assert.deepEqual(vals("15/10/2026"), ["date:2026-10-15"]);
    assert.deepEqual(vals("۱۵ اکتوبر"), ["date:10-15"]);
  });
  it("extracts percentages, including spoken", () => {
    assert.deepEqual(vals("you need 60% marks"), ["percent:60"]);
    assert.deepEqual(vals("sixty percent"), ["percent:60"]);
    assert.deepEqual(vals("۷۰ فیصد"), ["percent:70"]);
  });
  it("ignores years, small counts and words that merely contain number words", () => {
    assert.deepEqual(vals("2026-27 session, 133 credit hours, 3 preferences"), []);
    assert.deepEqual(vals("the document does not say"), []);
    assert.deepEqual(vals("lakhs of students apply"), []);
    // Regression: "hou[rs.]" / "we[rs]" must not be read as the "Rs." currency marker.
    assert.deepEqual(vals("A typical semester load is 15 to 18 credit hours."), []);
    assert.deepEqual(vals("18 credit hours"), []);
    assert.deepEqual(vals("about 40 hours per week"), []);
    assert.deepEqual(vals("PKR 500 late fee"), ["amount:500"]);
    assert.deepEqual(vals("500 rupees"), ["amount:500"]);
  });
});

describe("verifier: support rules", () => {
  it("accepts figures that come from this turn's facts, in any notation", () => {
    for (const r of ["The fee is PKR 185,000 per semester.", "Fee: 185000 PKR", "فیس ۱۸۵,۰۰۰ روپے ہے", "1.85 lakh", "ek lakh 85 hazar", "deadline 15 October 2026", "15 Oct", "in 24 days"])
      assert.equal(check(r).ok, true, r);
  });
  it("rejects a figure the tools did not return, in any notation", () => {
    for (const r of ["The fee is PKR 190,000.", "فیس ۱۹۰,۰۰۰ روپے", "1.9 lakh", "one hundred ninety thousand", "deadline is 20 October 2026", "2026-11-01"])
      assert.equal(check(r).ok, false, r);
  });
  it("rejects a sum or product the model computed itself", () => {
    assert.equal(check("Total for two semesters: PKR 370,000").ok, false);
  });
  it("accepts figures the student stated themselves", () => {
    assert.equal(check("With 60% marks you meet the requirement", ["I got 60% marks"]).ok, true);
    assert.equal(check("Yes, PKR 150,000 is below the listed fee", ["can I pay 150000?"]).ok, true);
  });
  it("lets a percentage come from a retrieved chunk, but never an amount or a date", () => {
    assert.equal(check("It covers 50% of tuition", [], ["The Merit Scholarship covers 50% of tuition."]).ok, true);
    assert.equal(check("The fee is PKR 99,000", [], ["Fee is PKR 99,000"]).ok, false);
    assert.equal(check("apply by 1 March", [], ["deadline 1 March"]).ok, false);
  });
  it("passes replies with no figures", () => {
    assert.equal(check("Please contact admissions for details.").ok, true);
  });
});
