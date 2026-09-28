import { H2, LegalDoc, P, Ul } from "@/components/LegalDoc";

// Source of truth: docs/legal/security-overview.md -- a factual description of what's actually built, kept in
// sync with it rather than restated from memory.
export default function SecurityOverviewPage() {
  return (
    <LegalDoc title="Security Overview">
      <P>A factual description of this platform&apos;s security posture, for a University&apos;s own security review before onboarding. Where something isn&apos;t built yet, this page says so rather than implying otherwise.</P>

      <H2>Multi-tenant data isolation</H2>
      <P>Every tenant-owned table has row-level security enabled and forced in Postgres, keyed on a tenant context the application sets per request. The database role the application connects as cannot bypass this — it owns none of the tables it queries and has no bypass privilege. This guarantee is exercised directly by this project&apos;s own automated test suite on every change, including &quot;tenant A and tenant B ask the same question, each gets their own answer&quot; tests across every channel.</P>

      <H2>Authentication</H2>
      <Ul>
        <li>Staff and platform-admin accounts authenticate via a verified JWT on every request.</li>
        <li>Role-based access control (Admin / Editor / Viewer) is enforced server-side on every route that needs it, never assumed from the dashboard UI — verified by automated tests for the specific things each role can and can&apos;t do.</li>
        <li>Platform admins are a wholly separate identity from any tenant&apos;s staff.</li>
      </Ul>

      <H2>Data in transit and at rest</H2>
      <P>TLS in transit. At rest, encryption depends on the hosting provider&apos;s own database encryption. Secrets stored in the database (e.g. WhatsApp access tokens) are additionally encrypted at the application layer and never returned to the client once saved.</P>

      <H2>PII handling</H2>
      <P>Obvious personal identifiers found inside a student&apos;s own message text are masked before that message is ever written to storage. Staff-facing alerts never include a student&apos;s name or phone number.</P>

      <H2>Voice data</H2>
      <P>Voice recordings are sent once to the speech-to-text provider for transcription and are never written to persistent storage — only the resulting transcript is saved.</P>

      <H2>Abuse protection</H2>
      <P>Rate limiting per IP, per tenant, and per chat session on every public chat request; a bot challenge gates the web widget&apos;s first message; every AI-generated reply is checked against the University&apos;s own stored facts before being shown, and an unsupported answer is replaced with a safe fallback rather than shown.</P>

      <H2>What is not yet built</H2>
      <Ul>
        <li>No error-tracking/APM integration exists yet — the Super Admin &quot;Platform Health&quot; page reports this honestly rather than fabricating uptime history.</li>
        <li>No independent third-party penetration test has been performed.</li>
        <li>The Windows desktop app&apos;s installer is not code-signed yet.</li>
        <li>In-app billing/payment processing is not built; no payment card is charged automatically.</li>
      </Ul>

      <H2>Reporting a security issue</H2>
      <P>[SECURITY CONTACT EMAIL] — placeholder until the operating entity is finalized.</P>
    </LegalDoc>
  );
}
