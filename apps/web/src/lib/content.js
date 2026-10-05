// Reads this demo site's content straight from /data/<tenant>/ at request/build time -- the exact same source files
// apps/api/src/seed/seed.ts loads into Postgres, so the site's static pages (programs, fees, campuses, ...) can
// never drift from what the chat widget answers from. The widget's live, verified answers are a separate layer on
// top of this (real API calls); these pages are the ordinary browsable content a university site needs regardless.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

// One real production deployment = one tenant's own site; which tenant this build serves is a deploy-time choice.
export const TENANT = process.env.NEXT_PUBLIC_TENANT ?? "crescent-valley";
const DATA_ROOT = join(process.cwd(), "..", "..", "data", TENANT);
const readJson = file => JSON.parse(readFileSync(join(DATA_ROOT, file), "utf-8"));
const approved = rows => rows.filter(r => r.status === "approved");
export const getTenant = () => readJson("tenant.json");
export const getFaculties = () => approved(readJson("faculties.json"));
export const getCampuses = () => approved(readJson("campuses.json"));
export const getPrograms = () => approved(readJson("programs.json"));
export const getFeeItems = () => approved(readJson("fee_items.json"));
export const getIntakes = () => approved(readJson("intakes.json"));
export const getRequirements = () => approved(readJson("requirements.json"));
export const getScholarships = () => approved(readJson("scholarships.json"));
export const getFaqs = () => readJson("faqs.json").filter(f => f.approved);
export function getDocuments() {
  const dir = join(DATA_ROOT, "documents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).sort().map(file => {
    const raw = readFileSync(join(dir, file), "utf-8").replace(/\r\n/g, "\n");
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    if (!m) throw new Error(`${file}: missing front matter`);
    const meta = Object.fromEntries(m[1].split("\n").map(l => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
    if (meta.approved !== "true") return null;
    return {
      file,
      title: meta.title,
      sourceType: meta.source_type,
      html: marked.parse(m[2], {
        async: false
      })
    };
  }).filter(d => d !== null);
}
export const getDocument = fileStartsWith => getDocuments().find(d => d.file.startsWith(fileStartsWith));

// ---------------------------------------------------------------- small lookup helpers used across pages
export const facultyName = key => getFaculties().find(f => f.key === key)?.name ?? key;
export const campusName = key => key ? getCampuses().find(c => c.key === key)?.name ?? key : "All campuses";
export const programName = key => key ? getPrograms().find(p => p.key === key)?.name ?? key : "All programs";
export const programsByFaculty = facultyKey => getPrograms().filter(p => p.faculty === facultyKey);
export const campusesForProgram = program => program.campuses.map(k => getCampuses().find(c => c.key === k)).filter(c => !!c);
export const feesForProgram = programKey => getFeeItems().filter(f => f.program === programKey);
export const generalFees = () => getFeeItems().filter(f => !f.program); // hostel, admission-wide, etc.
export const requirementFor = programKey => getRequirements().find(r => r.program === programKey);
export const intakesFor = programKey => getIntakes().filter(i => i.programs === "all" || i.programs.includes(programKey));
export const money = (amount, currency) => `${currency} ${amount.toLocaleString("en-US")}`;
export const dateLabel = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric"
});
export const daysUntil = (iso, today = new Date()) => Math.round((new Date(iso + "T00:00:00").getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);