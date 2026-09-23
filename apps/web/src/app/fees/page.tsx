import { getPrograms, feesForProgram, generalFees, campusName, money, dateLabel, getDocument } from "@/lib/content";
import { PageHero, Section, Card, Pill } from "@/components/PageHero";

const ITEM_LABEL: Record<string, string> = { tuition: "Tuition", admission: "Admission fee", hostel: "Hostel", other: "Other" };
const PER_LABEL: Record<string, string> = { semester: "per semester", year: "per year", "one-time": "one-time", credit_hour: "per credit hour" };

function FeeTable({ rows }: { rows: ReturnType<typeof feesForProgram> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3">Campus</th>
            <th className="px-4 py-3">Student Type</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">As of</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((f) => (
            <tr key={f.key}>
              <td className="px-4 py-3 font-medium text-gray-900">{ITEM_LABEL[f.item_type] ?? f.item_type}</td>
              <td className="px-4 py-3 text-gray-600">{campusName(f.campus)}</td>
              <td className="px-4 py-3 capitalize text-gray-600">{f.student_type}</td>
              <td className="px-4 py-3 font-semibold text-primary">{money(f.amount, f.currency)} <span className="font-normal text-gray-500">{PER_LABEL[f.per] ?? f.per}</span></td>
              <td className="px-4 py-3 text-xs text-gray-400">{dateLabel(f.last_verified_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FeesPage() {
  const programs = getPrograms();
  const general = generalFees();
  const policy = getDocument("04-fee-payment-policy");

  return (
    <>
      <PageHero title="Fee Structure" subtitle="Tuition and other fees by program, campus and student type. All figures are for the current academic year unless noted." />

      <Section>
        {programs.map((p) => {
          const rows = feesForProgram(p.key);
          if (!rows.length) return null;
          return (
            <div key={p.key} id={p.key} className="mb-10 scroll-mt-20">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{p.name}</h2>
                <Pill>{p.code}</Pill>
              </div>
              <FeeTable rows={rows} />
            </div>
          );
        })}

        {programs.some((p) => feesForProgram(p.key).length === 0) && (
          <Card className="mb-10 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800">
              <strong>Not yet published:</strong> {programs.filter((p) => feesForProgram(p.key).length === 0).map((p) => p.name).join(", ")}.
              Ask the chat assistant or contact admissions for the latest figure.
            </p>
          </Card>
        )}

        {general.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-3 text-xl font-bold text-gray-900">Other Fees (Hostel &amp; General)</h2>
            <FeeTable rows={general} />
          </div>
        )}
      </Section>

      {policy && (
        <Section className="border-t border-gray-200">
          <div className="prose-doc max-w-3xl" dangerouslySetInnerHTML={{ __html: policy.html }} />
        </Section>
      )}
    </>
  );
}
