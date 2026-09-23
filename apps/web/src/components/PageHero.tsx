export function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="relative overflow-hidden bg-gray-900">
      <div className="uaa-hero-texture absolute inset-0 opacity-[0.12]" />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(900px 360px at 10% 0%, var(--color-primary), transparent), radial-gradient(600px 320px at 100% 100%, var(--color-accent), transparent)" }}
      />
      <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-20 lg:px-12 xl:px-16">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-300">{subtitle}</p>}
      </div>
    </div>
  );
}

export function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`mx-auto max-w-7xl scroll-mt-20 px-6 py-10 lg:px-12 xl:px-16 ${className}`}>{children}</div>;
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
