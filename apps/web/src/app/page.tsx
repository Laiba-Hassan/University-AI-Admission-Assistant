import Link from "next/link";
import { getTenant, getFaculties, getPrograms, getCampuses, getIntakes, getDocument, dateLabel, daysUntil } from "@/lib/content";
import { Section, Card, Pill } from "@/components/PageHero";

export default function HomePage() {
  const tenant = getTenant();
  const faculties = getFaculties();
  const programs = getPrograms();
  const campuses = getCampuses();
  const about = getDocument("01-about");
  const upcoming = getIntakes()
    .filter((i) => daysUntil(i.application_deadline) >= 0)
    .sort((a, b) => a.application_deadline.localeCompare(b.application_deadline))[0];

  return (
    <>
      {/* Fills the screen on load, like a real university site's banner -- 100dvh minus the sticky nav's own
          height, so hero + nav together occupy exactly one viewport (dvh accounts for mobile browser chrome). */}
      <section className="relative flex min-h-[calc(100dvh-73px)] items-center overflow-hidden border-b border-gray-200 bg-gray-900">
        {/* No photography in a fictional demo tenant; a deep brand-colour gradient with a soft texture reads as
            institutional rather than templated, and avoids a fake "stock photo" of a campus that doesn't exist. */}
        <div className="uaa-hero-texture absolute inset-0 opacity-[0.15]" />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(1100px 480px at 15% -10%, var(--color-primary), transparent), radial-gradient(700px 420px at 100% 10%, var(--color-accent), transparent)" }}
        />
        <div className="relative mx-auto w-full max-w-7xl px-6 py-20 lg:px-12 xl:px-16">
          {upcoming && (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Applications open for {upcoming.intake_name} — closes {dateLabel(upcoming.application_deadline)}
            </div>
          )}
          <p className="font-semibold tracking-wide text-accent">{tenant.branding.tagline}</p>
          <h1 className="mt-3 max-w-3xl font-heading text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-6xl">
            {tenant.name}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-300">{tenant.welcome_message}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/admissions" className="rounded-full bg-accent px-6 py-3 font-semibold text-gray-900 shadow-lg shadow-accent/20 transition hover:opacity-90">
              Apply Now
            </Link>
            <Link href="/programs" className="rounded-full border border-white/25 bg-white/5 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/10">
              Explore Programs
            </Link>
          </div>
          <p className="mt-8 flex items-center gap-2 text-sm text-gray-400">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            Have a quick question? Our AI Admissions Assistant (bottom-right) answers instantly in English, Roman Urdu or Urdu.
          </p>
        </div>
      </section>

      <Section className="grid grid-cols-2 gap-4 py-12 sm:grid-cols-4">
        {[
          [faculties.length, "Faculties"],
          [programs.length, "Programs"],
          [campuses.length, "Campuses"],
          ["3", "Languages supported"],
        ].map(([n, label]) => (
          <Card key={label as string} className="text-center">
            <div className="font-heading text-3xl font-semibold text-primary">{n}</div>
            <div className="mt-1 text-sm text-gray-500">{label}</div>
          </Card>
        ))}
      </Section>

      {upcoming && (
        <Section className="py-0">
          <Card className="flex flex-col items-start justify-between gap-3 border-accent/30 bg-accent/5 sm:flex-row sm:items-center">
            <div>
              <Pill>Upcoming intake</Pill>
              <p className="mt-2 font-semibold text-gray-900">
                {upcoming.intake_name} — applications close {dateLabel(upcoming.application_deadline)}
              </p>
              <p className="text-sm text-gray-500">Entry test: {dateLabel(upcoming.test_date)} · Classes start: {dateLabel(upcoming.classes_start)}</p>
            </div>
            <Link href="/admissions" className="whitespace-nowrap rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
              See admission steps
            </Link>
          </Card>
        </Section>
      )}

      {about && (
        <Section>
          {/* The document's own front-matter title renders as its first heading; no separate wrapper heading here. */}
          <div className="prose-doc max-w-3xl" dangerouslySetInnerHTML={{ __html: about.html }} />
        </Section>
      )}

      <Section>
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Faculties</h2>
          <Link href="/faculties" className="text-sm font-medium text-primary hover:underline">View all</Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {faculties.map((f) => (
            <Card key={f.key}>
              <h3 className="font-semibold text-gray-900">{f.name}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {programs.filter((p) => p.faculty === f.key).length} program{programs.filter((p) => p.faculty === f.key).length === 1 ? "" : "s"}
              </p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
