import { H2, LegalDoc, P } from "@/components/LegalDoc";

// Source of truth: docs/legal/terms-of-service-DRAFT.md -- keep these in sync when that file changes.
export default function TermsOfServicePage() {
  return <LegalDoc title="Terms of Service" draft>
      <P>These terms govern a University&apos;s use of Enrollium (the platform providing an AI admissions assistant embedded on the University&apos;s website and, where connected, WhatsApp) and a University staff member&apos;s use of its dashboard.</P>

      <H2>The service</H2>
      <P>Enrollium answers prospective-student questions from a University&apos;s own approved knowledge base (programs, fees, intakes, requirements, scholarships, FAQs), captures leads with the student&apos;s consent, and hands a conversation to University staff when asked or when it cannot answer. Answers are checked against the University&apos;s own stored facts before being shown; the platform does not invent figures.</P>

      <H2>Accounts and access</H2>
      <P>A University&apos;s account starts as a signup request, reviewed and approved by a platform administrator before any tenant is created. Staff accounts within an approved University are invited by that University&apos;s own admins and carry one of three roles (Admin, Editor, Viewer), each with a different, enforced level of access.</P>

      <H2>Acceptable use</H2>
      <P>A University may not use the platform to publish false or misleading information to prospective students, to collect personal data without the consent this platform&apos;s own lead-capture flow requires, or to attempt to bypass the tenant isolation, rate limiting, or verification-before-answering safeguards built into the platform.</P>

      <H2>Plans, limits and billing</H2>
      <P>A University&apos;s plan sets its monthly conversation and message caps, visible in its own Settings → Usage. In-app billing (a real payment gateway) is not yet built — billing today is tracked manually by the platform operator until a real payment integration ships. No payment card is charged by this platform automatically.</P>

      <H2>Data ownership and export</H2>
      <P>A University owns the data it and its applicants generate. It can export that data at any time (Settings → Retention → &quot;Export data&quot;). See our <a href="/legal/privacy" className="text-accent hover:underline">Privacy Policy</a> for how that data is handled and for how long it&apos;s retained by default.</P>

      <H2>Suspension and termination</H2>
      <P>A platform administrator may suspend a University&apos;s account for abuse, non-payment, or a breach of these terms; a suspended University&apos;s assistant stops answering but its data is not deleted on suspension alone.</P>

      <H2>Contact</H2>
      <P>[LEGAL CONTACT EMAIL] · [REGISTERED ADDRESS] — placeholders until the operating entity is finalized.</P>
    </LegalDoc>;
}