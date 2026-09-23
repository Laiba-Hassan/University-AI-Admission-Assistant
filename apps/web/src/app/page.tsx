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
      <section className="border-b border-gray-200 bg-gradient-to-b from-primary/10 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <p className="font-semibold text-accent">{tenant.branding.tagline}</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-bold text-gray-900 sm:text-5xl">{tenant.name}</h1>
          <p className="mt-4 max-w-xl text-lg text-gray-600">{tenant.welcome_message}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/programs" className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:opacity-90">
              Explore Programs
            </Link>
            <Link href="/admissions" className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-50">
              How to Apply
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-500">
            Have a quick question? Use the chat assistant in the corner — it answers from our official program, fee
            and deadline data, in English, Roman Urdu or Urdu.
          </p>
        </div>
      </section>

      <Section className="grid grid-cols-2 gap-4 py-10 sm:grid-cols-4">
        {[
          [faculties.length, "Faculties"],
          [programs.length, "Programs"],
          [campuses.length, "Campuses"],
          [tenant.default_reply_script === "roman_urdu" ? "3" : "3", "Languages supported"],
        ].map(([n, label]) => (
          <Card key={label as string} className="text-center">
            <div className="text-3xl font-bold text-primary">{n}</div>
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
            <Link href="/admissions" className="whitespace-nowrap rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
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
          <h2 className="text-2xl font-bold text-gray-900">Faculties</h2>
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
