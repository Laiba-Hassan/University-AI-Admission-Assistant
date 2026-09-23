export function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="uaa-hero-texture border-b border-gray-200 bg-gradient-to-b from-primary/[0.06] to-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-16">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-600">{subtitle}</p>}
      </div>
    </div>
  );
}

export function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`mx-auto max-w-6xl scroll-mt-20 px-4 py-10 ${className}`}>{children}</div>;
}

export function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${className}`}>
      {children}
    </div>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{children}</span>;
}
