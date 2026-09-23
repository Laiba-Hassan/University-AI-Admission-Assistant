import Link from "next/link";
import type { TenantInfo } from "@/lib/content";

const LINKS = [
  ["/", "Home"], ["/programs", "Programs"], ["/faculties", "Faculties"], ["/admissions", "Admissions"],
  ["/fees", "Fee Structure"], ["/scholarships", "Scholarships"], ["/campuses", "Campuses"], ["/contact", "Contact"],
] as const;

export function Nav({ tenant }: { tenant: TenantInfo }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      {/* Full-width bar (no max-width cap), generous side padding -- matches how a real university site's nav
          spans the whole screen rather than sitting in a narrow centred column. */}
      <div className="flex items-center gap-10 px-6 py-4 lg:px-12 xl:px-16">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-base font-heading font-semibold text-white shadow-sm">
            {tenant.name.slice(0, 1)}
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight text-gray-900">{tenant.name}</span>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-9 text-sm font-medium text-gray-600 lg:flex">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap transition-colors hover:text-primary">{label}</Link>
          ))}
        </nav>

        <Link
          href="/admissions"
          className="ml-auto hidden shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:inline-block lg:ml-0"
        >
          Apply Now
        </Link>
      </div>
      {/* Compact wrapped nav for narrower widths, where the row above hides links (or all of it below sm). */}
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 px-6 py-2.5 text-xs font-medium text-gray-600 lg:hidden">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="hover:text-primary">{label}</Link>
        ))}
        <Link href="/admissions" className="ml-auto rounded-full bg-primary px-3 py-1 font-semibold text-white sm:hidden">Apply</Link>
      </nav>
    </header>
  );
}
