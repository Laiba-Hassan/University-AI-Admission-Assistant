import { H2, LegalDoc, P, Ul } from "@/components/LegalDoc";

// Source of truth: docs/legal/privacy-policy-DRAFT.md -- keep these in sync when that file changes.
export default function PrivacyPolicyPage() {
  return <LegalDoc title="Privacy Policy" draft>
      <P><strong>Platform:</strong> Enrollium (&quot;we&quot;, &quot;the platform&quot;). We provide an AI admissions assistant to universities (&quot;Universities&quot;), embedded on their own websites and, where a University connects it, on WhatsApp.</P>

      <H2>Who is responsible for your data</H2>
      <P>For students who chat with a University&apos;s assistant, <strong>the University is the controller</strong> and Enrollium acts as its <strong>processor</strong>. For University staff accounts, and for a university&apos;s own sign-up request to join the platform, Enrollium is the controller.</P>

      <H2>What we collect</H2>
      <Ul>
        <li><strong>Messages you send</strong> (text; and the transcript of voice notes/recordings). Audio is sent to our speech-to-text provider for transcription and is <strong>never written to our database</strong> — only the resulting text is stored, exactly like a typed message.</li>
        <li><strong>Details you choose to give</strong>: name, phone/email, program interest, and your explicit consent, when you ask to be contacted (a &quot;lead&quot;).</li>
        <li><strong>Technical data</strong>: channel (web or WhatsApp), detected language, timestamps, an anonymous session id (web) or your WhatsApp ID (WhatsApp).</li>
        <li><strong>Staff data</strong> (for University employees using the dashboard): email, role, notification preferences.</li>
      </Ul>
      <P>Before anything is stored, obvious personal identifiers (phone numbers, email addresses) inside a message&apos;s own text are masked at the point of writing, and staff alerts never include a student&apos;s name or phone number even when the underlying conversation does.</P>

      <H2>How we use it</H2>
      <P>To answer your questions using only the University&apos;s own approved information (never inventing an answer), to route your conversation to a staff member when you ask to speak with one or when the assistant cannot answer, and to keep the service secure and working.</P>

      <H2>Who we share it with</H2>
      <P>See our <a href="https://github.com/Laiba-Hassan/University-AI-Admission-Assistant/blob/main/docs/legal/subprocessors.md" className="text-accent hover:underline" target="_blank" rel="noreferrer">sub-processor list</a> for the current, factual list of every vendor and what each one can see. <strong>We do not sell personal data</strong>, to anyone, ever.</P>
      <P>If a University connects its own automation workflow (Settings → Automations), event notifications are delivered to a destination <strong>the University itself configures and controls</strong> — we are not a party to what that destination does with it.</P>

      <H2>Retention and your rights</H2>
      <P>Each University sets its own retention period for conversation data (90 days by default for a newly approved University, editable in that University&apos;s own Settings). After that window, conversations are deleted. You can ask the University (or Enrollium directly, for staff account data) to export or delete data associated with you.</P>

      <H2>Security</H2>
      <P>Every University&apos;s data is isolated at the database level by row-level security enforced on every query. Access to a University&apos;s dashboard is logged. Data is encrypted in transit and, via our hosting provider, at rest.</P>

      <H2>Voice recordings, specifically</H2>
      <P>A voice note or the web widget&apos;s mic recording is sent once to our speech-to-text provider, transcribed, and the audio is discarded immediately after — never written to persistent storage, never replayed by staff, never used to train any model.</P>

      <H2>Contact</H2>
      <P>[PRIVACY CONTACT EMAIL] · [REGISTERED ADDRESS] — placeholders until the operating entity is finalized.</P>
    </LegalDoc>;
}