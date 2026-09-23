import Link from "next/link";
import type { TenantInfo } from "@/lib/content";

const LINKS = [
  ["/", "Home"], ["/programs", "Programs"], ["/faculties", "Faculties"], ["/admissions", "Admissions"],
  ["/fees", "Fee Structure"], ["/scholarships", "Scholarships"], ["/campuses", "Campuses"], ["/contact", "Contact"],
] as const;

export function Nav({ tenant }: { tenant: TenantInfo }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            {tenant.name.slice(0, 1)}
          </span>
          <span className="text-lg">{tenant.name}</span>
        </Link>
        <nav className="hidden gap-5 text-sm font-medium text-gray-600 md:flex">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-primary">{label}</Link>
          ))}
        </nav>
      </div>
      {/* Mobile nav: a simple wrapped row rather than a hamburger, keeps the demo site dependency-free */}
      <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-xs font-medium text-gray-600 md:hidden">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="hover:text-primary">{label}</Link>
        ))}
      </nav>
    </header>
  );
}
