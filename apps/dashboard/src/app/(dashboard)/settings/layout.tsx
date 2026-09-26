"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/settings/channels", "Channels"], ["/settings/branding", "Branding"], ["/settings/messages", "Messages"],
  ["/settings/retention", "Retention"], ["/settings/team", "Team"], ["/settings/usage", "Usage"],
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">Settings</h1>
      <div className="mt-5 grid gap-5 lg:grid-cols-[180px_1fr]">
        <nav className="card flex flex-row gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {TABS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${pathname === href ? "bg-tint text-accent" : "text-ink-2 hover:bg-tint"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="card p-5">{children}</div>
      </div>
    </div>
  );
}
