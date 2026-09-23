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

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(DATA_ROOT, file), "utf-8"));

export interface TenantInfo {
  name: string; subdomain: string; branding: { primary: string; accent: string; logo?: string; tagline?: string };
  welcome_message: string; working_hours: { tz: string; mon_fri: string | null; sat: string | null; sun: string | null };
  default_reply_script: string;
}
export interface Faculty { key: string; name: string; status: string }
export interface Campus { key: string; name: string; city: string; status: string }
export interface Program {
  key: string; faculty: string; name: string; code: string; degree_level: string;
  total_credit_hours: number; campuses: string[]; status: string;
}
export interface FeeItem {
  key: string; program: string | null; campus: string | null; academic_year: string; student_type: string;
  item_type: string; amount: number; currency: string; per: string; effective_from: string;
  last_verified_at: string; status: string; note?: string;
}
export interface Intake {
  key: string; intake_name: string; programs: "all" | string[]; applications_open: string;
  application_deadline: string; test_date: string; classes_start: string; last_verified_at: string; status: string;
}
export interface Requirement { program: string; eligibility: string; required_documents: string; status: string }
export interface Scholarship {
  key: string; name: string; criteria: string; coverage: string; conditions: string; deadline: string | null; status: string;
}
export interface Faq { question: string; answer: string; approved: boolean }
export interface Doc { file: string; title: string; sourceType: string; html: string }

const approved = <T extends { status: string }>(rows: T[]) => rows.filter((r) => r.status === "approved");

export const getTenant = () => readJson<TenantInfo>("tenant.json");
export const getFaculties = () => approved(readJson<Faculty[]>("faculties.json"));
export const getCampuses = () => approved(readJson<Campus[]>("campuses.json"));
export const getPrograms = () => approved(readJson<Program[]>("programs.json"));
export const getFeeItems = () => approved(readJson<FeeItem[]>("fee_items.json"));
export const getIntakes = () => approved(readJson<Intake[]>("intakes.json"));
export const getRequirements = () => approved(readJson<Requirement[]>("requirements.json"));
export const getScholarships = () => approved(readJson<Scholarship[]>("scholarships.json"));
export const getFaqs = () => readJson<Faq[]>("faqs.json").filter((f) => f.approved);

export function getDocuments(): Doc[] {
  const dir = join(DATA_ROOT, "documents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((file) => {
    const raw = readFileSync(join(dir, file), "utf-8").replace(/\r\n/g, "\n");
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    if (!m) throw new Error(`${file}: missing front matter`);
    const meta = Object.fromEntries(m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
    if (meta.approved !== "true") return null;
    return { file, title: meta.title!, sourceType: meta.source_type!, html: marked.parse(m[2]!, { async: false }) as string };
  }).filter((d): d is Doc => d !== null);
}
export const getDocument = (fileStartsWith: string) => getDocuments().find((d) => d.file.startsWith(fileStartsWith));

// ---------------------------------------------------------------- small lookup helpers used across pages
export const facultyName = (key: string) => getFaculties().find((f) => f.key === key)?.name ?? key;
export const campusName = (key: string | null) => (key ? getCampuses().find((c) => c.key === key)?.name ?? key : "All campuses");
export const programName = (key: string | null) => (key ? getPrograms().find((p) => p.key === key)?.name ?? key : "All programs");
export const programsByFaculty = (facultyKey: string) => getPrograms().filter((p) => p.faculty === facultyKey);
export const campusesForProgram = (program: Program) => program.campuses.map((k) => getCampuses().find((c) => c.key === k)).filter((c): c is Campus => !!c);
export const feesForProgram = (programKey: string) => getFeeItems().filter((f) => f.program === programKey);
export const generalFees = () => getFeeItems().filter((f) => !f.program); // hostel, admission-wide, etc.
export const requirementFor = (programKey: string) => getRequirements().find((r) => r.program === programKey);
export const intakesFor = (programKey: string) => getIntakes().filter((i) => i.programs === "all" || i.programs.includes(programKey));

export const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString("en-US")}`;
export const dateLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
export const daysUntil = (iso: string, today = new Date()) => Math.round((new Date(iso + "T00:00:00").getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
