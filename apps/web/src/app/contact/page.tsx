import { getTenant, getCampuses, getDocument } from "@/lib/content";
import { PageHero, Section, Card } from "@/components/PageHero";

const DAY_ROWS = [
  ["Monday – Friday", "mon_fri"],
  ["Saturday", "sat"],
  ["Sunday", "sun"],
] as const;

export default function ContactPage() {
  const tenant = getTenant();
  const campuses = getCampuses();
  const doc = getDocument("10-contact-and-visit");
  const hours = tenant.working_hours;

  return (
    <>
      <PageHero title="Contact" subtitle="Office hours, campus locations, and how to reach us." />
      <Section className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold text-gray-900">Admissions office hours</h2>
            <p className="text-xs text-gray-400">Timezone: {hours.tz}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {DAY_ROWS.map(([label, key]) => (
                <div key={key} className="flex justify-between">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-800">{hours[key] ?? "Closed"}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <h2 className="font-semibold text-gray-900">Fastest way to get an answer</h2>
            <p className="mt-2 text-sm text-gray-600">
              Use the chat assistant (bottom-right corner of any page) — available any time, in English, Roman Urdu
              or Urdu. If it can&apos;t help, it will connect you with our staff during office hours.
            </p>
          </Card>
        </div>

        <div>
          <h2 className="font-semibold text-gray-900">Campuses</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {campuses.map((c) => (
              <Card key={c.key}>
                <p className="font-semibold text-gray-900">{c.name}</p>
                <p className="text-sm text-gray-500">{c.city}</p>
              </Card>
            ))}
          </div>
          {doc && <div className="prose-doc mt-6" dangerouslySetInnerHTML={{ __html: doc.html }} />}
        </div>
      </Section>
    </>
  );
}
