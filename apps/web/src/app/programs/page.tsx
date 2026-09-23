import Link from "next/link";
import { getPrograms, getFaculties, campusesForProgram, feesForProgram } from "@/lib/content";
import { PageHero, Section, Card, Pill } from "@/components/PageHero";

const LEVEL_LABEL: Record<string, string> = { diploma: "Diploma", bachelor: "Bachelor's", master: "Master's", doctorate: "Doctorate" };

export default function ProgramsPage() {
  const faculties = getFaculties();
  const programs = getPrograms();

  return (
    <>
      <PageHero title="Programs" subtitle="All degree programs currently offered, grouped by faculty." />
      <Section>
        {faculties.map((faculty) => {
          const list = programs.filter((p) => p.faculty === faculty.key);
          if (!list.length) return null;
          return (
            <div key={faculty.key} className="mb-10">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">{faculty.name}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((p) => {
                  const hasFees = feesForProgram(p.key).length > 0;
                  return (
                    <Card key={p.key} className="flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-gray-900">{p.name}</h3>
                        <Pill>{p.code}</Pill>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{LEVEL_LABEL[p.degree_level] ?? p.degree_level} · {p.total_credit_hours} credit hours</p>
                      <p className="mt-2 text-sm text-gray-600">
                        Offered at: {campusesForProgram(p).map((c) => c.name).join(", ")}
                      </p>
                      {!hasFees && (
                        <p className="mt-2 text-xs text-amber-700">Fee not yet published — ask the chat assistant or contact admissions.</p>
                      )}
                      <div className="mt-4 flex gap-3 text-sm font-medium">
                        <Link href={`/fees#${p.key}`} className="text-primary hover:underline">Fees</Link>
                        <Link href={`/admissions#${p.key}`} className="text-primary hover:underline">Requirements</Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Section>
    </>
  );
}
