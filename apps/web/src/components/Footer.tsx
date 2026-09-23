import type { TenantInfo } from "@/lib/content";

export function Footer({ tenant }: { tenant: TenantInfo }) {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-gray-500">
        <p className="font-semibold text-gray-700">{tenant.name}</p>
        <p className="mt-1">Demo — fictional data, built to demonstrate the University AI Admission Assistant platform.</p>
        <p className="mt-4 text-xs text-gray-400">
          An AI assistant is used on this site to answer admissions questions. Messages are stored, and voice
          recordings are transcribed and not kept.
        </p>
      </div>
    </footer>
  );
}
