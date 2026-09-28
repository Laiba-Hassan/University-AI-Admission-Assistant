import Link from "next/link";

export function LegalDoc({ title, draft, children }: { title: string; draft?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-xs font-semibold text-accent hover:underline">← Enrollium</Link>
        <h1 className="mt-3 font-heading text-[26px] font-semibold text-ink">{title}</h1>
        {draft && (
          <p className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--chip-rejected-fg)", color: "var(--chip-rejected-fg)" }}>
            Draft — not legal advice, and not yet reviewed by a lawyer. Published here so it&apos;s reachable and reviewable, not represented as final.
          </p>
        )}
        <div className="legal-doc mt-6 space-y-5 text-sm leading-relaxed text-ink-2">{children}</div>
      </div>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="!mt-8 font-heading text-lg font-semibold text-ink">{children}</h2>;
}
export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}
export function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}
