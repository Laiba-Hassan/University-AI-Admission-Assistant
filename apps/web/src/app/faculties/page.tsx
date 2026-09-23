import { getFaculties, getPrograms } from "@/lib/content";
import { PageHero, Section, Card } from "@/components/PageHero";

export default function FacultiesPage() {
  const faculties = getFaculties();
  const programs = getPrograms();

  return (
    <>
      <PageHero title="Faculties" subtitle="Our academic faculties and the programs each one offers." />
      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          {faculties.map((f) => {
            const list = programs.filter((p) => p.faculty === f.key);
            return (
              <Card key={f.key}>
                <h2 className="text-lg font-bold text-gray-900">{f.name}</h2>
                <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                  {list.map((p) => (
                    <li key={p.key} className="flex justify-between gap-3">
                      <span>{p.name}</span>
                      <span className="whitespace-nowrap text-gray-400">{p.code}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}
