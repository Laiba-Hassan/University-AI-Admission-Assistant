import Link from "next/link";
import type { TenantInfo } from "@/lib/content";

const COLUMNS = [
  { title: "Academics", links: [["/programs", "Programs"], ["/faculties", "Faculties"], ["/scholarships", "Scholarships"]] },
  { title: "Admissions", links: [["/admissions", "How to Apply"], ["/fees", "Fee Structure"], ["/admissions#faq", "FAQs"]] },
  { title: "About", links: [["/campuses", "Campuses"], ["/contact", "Contact & Office Hours"]] },
] as const;

export function Footer({ tenant }: { tenant: TenantInfo }) {
  return (
    <footer className="mt-20 border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-heading font-semibold text-white">
                {tenant.name.slice(0, 1)}
              </span>
              <span className="font-heading text-base font-semibold text-gray-900">{tenant.name}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-gray-500">{tenant.branding.tagline}</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{col.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-gray-600">
                {col.links.map(([href, label]) => (
                  <li key={href}><Link href={href} className="hover:text-primary">{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-gray-200 pt-6 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {tenant.name}. Demo — fictional data, built to demonstrate the University AI Admission Assistant platform.</p>
          <p className="max-w-md sm:text-right">
            An AI assistant is used on this site to answer admissions questions. Messages are stored, and voice
            recordings are transcribed and not kept.
          </p>
        </div>
      </div>
    </footer>
  );
}
