import { getDocument, getIntakes, getPrograms, requirementFor, programName, getFaqs, dateLabel, daysUntil } from "@/lib/content";
import { PageHero, Section, Card, Pill } from "@/components/PageHero";

export default function AdmissionsPage() {
  const process = getDocument("02-admission-process");
  const intakes = getIntakes();
  const programs = getPrograms();
  const faqs = getFaqs();

  return (
    <>
      <PageHero title="Admissions & Guidelines" subtitle="How to apply, current intake dates, program requirements and common questions." />

      {process && (
        <Section className="pb-0">
          <div className="prose-doc max-w-3xl" dangerouslySetInnerHTML={{ __html: process.html }} />
        </Section>
      )}

      <Section>
        <h2 className="text-2xl font-semibold text-gray-900">Intake Dates</h2>
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Intake</th>
                <th className="px-4 py-3">Applications Open</th>
                <th className="px-4 py-3">Application Deadline</th>
                <th className="px-4 py-3">Entry Test</th>
                <th className="px-4 py-3">Classes Start</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {intakes.map((i) => {
                const passed = daysUntil(i.application_deadline) < 0;
                return (
                  <tr key={i.key}>
                    <td className="px-4 py-3 font-medium text-gray-900">{i.intake_name}</td>
                    <td className="px-4 py-3 text-gray-600">{dateLabel(i.applications_open)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {dateLabel(i.application_deadline)} {passed && <span className="ml-1 text-xs text-red-600">(closed)</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{dateLabel(i.test_date)}</td>
                    <td className="px-4 py-3 text-gray-600">{dateLabel(i.classes_start)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">Dates last verified {dateLabel([...intakes].sort((a, b) => b.last_verified_at.localeCompare(a.last_verified_at))[0]?.last_verified_at ?? "")}.</p>
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold text-gray-900">Eligibility & Required Documents</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {programs.map((p) => {
            const req = requirementFor(p.key);
            if (!req) return null;
            return (
              <Card key={p.key} id={p.key}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{programName(p.key)}</h3>
                  <Pill>{p.code}</Pill>
                </div>
                <p className="mt-2 text-sm text-gray-600"><strong className="text-gray-800">Eligibility:</strong> {req.eligibility}</p>
                <p className="mt-1.5 text-sm text-gray-600"><strong className="text-gray-800">Documents:</strong> {req.required_documents}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold text-gray-900">Frequently Asked Questions</h2>
        <div className="mt-5 max-w-3xl divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {faqs.map((f, i) => (
            <details key={i} className="group px-5 py-4 open:bg-gray-50">
              <summary className="cursor-pointer list-none font-medium text-gray-900 marker:content-none">
                <span className="mr-2 inline-block text-primary transition-transform group-open:rotate-90">›</span>
                {f.question}
              </summary>
              <p className="mt-2 pl-5 text-sm text-gray-600">{f.answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
