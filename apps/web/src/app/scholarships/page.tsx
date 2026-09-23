import { getScholarships, getDocument, dateLabel, daysUntil } from "@/lib/content";
import { PageHero, Section, Card, Pill } from "@/components/PageHero";

export default function ScholarshipsPage() {
  const scholarships = getScholarships();
  const doc = getDocument("03-scholarships-explained");

  return (
    <>
      <PageHero title="Scholarships & Financial Aid" subtitle="Ways to reduce your fees, based on merit, need or other criteria." />
      <Section>
        <div className="grid gap-5 sm:grid-cols-2">
          {scholarships.map((s) => {
            const passed = s.deadline ? daysUntil(s.deadline) < 0 : false;
            return (
              <Card key={s.key}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">{s.name}</h3>
                  {s.deadline && <Pill>{passed ? "Closed" : `Due ${dateLabel(s.deadline)}`}</Pill>}
                </div>
                <p className="mt-2 text-sm text-gray-600"><strong className="text-gray-800">Coverage:</strong> {s.coverage}</p>
                <p className="mt-1.5 text-sm text-gray-600"><strong className="text-gray-800">Criteria:</strong> {s.criteria}</p>
                {s.conditions && <p className="mt-1.5 text-sm text-gray-600"><strong className="text-gray-800">Conditions:</strong> {s.conditions}</p>}
              </Card>
            );
          })}
        </div>
      </Section>
      {doc && (
        <Section className="border-t border-gray-200">
          <div className="prose-doc max-w-3xl" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </Section>
      )}
    </>
  );
}
