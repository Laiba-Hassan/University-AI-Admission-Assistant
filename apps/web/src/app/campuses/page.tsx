import Link from "next/link";
import { getCampuses, getPrograms } from "@/lib/content";
import { PageHero, Section, Card } from "@/components/PageHero";

export default function CampusesPage() {
  const campuses = getCampuses();
  const programs = getPrograms();

  return (
    <>
      <PageHero title="Campuses" subtitle="Our campus locations and what's offered at each." />
      <Section>
        <div className="grid gap-5 sm:grid-cols-2">
          {campuses.map((c) => {
            const list = programs.filter((p) => p.campuses.includes(c.key));
            return (
              <Card key={c.key}>
                <h2 className="text-lg font-semibold text-gray-900">{c.name}</h2>
                <p className="text-sm text-gray-500">{c.city}</p>
                <p className="mt-3 text-sm font-medium text-gray-700">Programs offered here ({list.length}):</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                  {list.map((p) => <li key={p.key}>{p.name}</li>)}
                </ul>
              </Card>
            );
          })}
        </div>
      </Section>
      <Section className="border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Directions, visiting hours and how to book a campus tour are on the{" "}
          <Link href="/contact" className="font-medium text-primary hover:underline">Contact page</Link>.
        </p>
      </Section>
    </>
  );
}
