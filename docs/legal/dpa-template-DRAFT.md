# Data Processing Agreement — DRAFT template (lawyer review required before use with a real University)

Between **[University]** (Controller) and **Enrollium** (Processor).

1. **Subject matter & duration.** Processing of student and staff personal data to operate the University's AI
   admissions assistant, for the term of the service agreement.
2. **Nature & purpose.** Answer enquiries from the University's own approved knowledge base; capture leads with
   explicit consent; route conversations to University staff on request or when unanswered; provide the
   University's own usage analytics. Categories of data: names, contact details, enquiry content, voice-note
   transcripts (never the audio itself — see below). Data subjects: prospective students, University staff.
3. **Processor obligations.** Process only on the Controller's documented instructions (the University's own
   configuration of the platform); confidentiality of personnel with access; appropriate technical security —
   database-level tenant isolation enforced by row-level security on every query (not just application-layer
   filtering), encryption in transit and at rest, access logging; assist with data-subject export/delete
   requests; notify the Controller of a personal-data breach without undue delay [within __ hours].
4. **Sub-processors.** The Controller authorizes those listed in [`subprocessors.md`](./subprocessors.md),
   reviewed and kept current with what the platform actually integrates with; the Processor will give [30] days'
   notice of a new one, with a right to object. Where the University itself configures a third-party automation
   destination (Settings → Automations), that destination is the University's own choice, not a Processor
   sub-processor under this agreement.
5. **Retention & deletion.** Conversations are deleted after the University's own configured retention period
   (90 days by default for a newly approved University, editable by the University at any time). Voice audio is
   discarded immediately after transcription and is never retained. **On termination:** the Controller can export
   its own data via the dashboard's Settings → Retention "Export data" (conversations, leads, and every knowledge
   entity); a full account-and-data deletion is, as of this document's writing, an operation the Processor
   carries out on request rather than a fully self-serve button in the product — [complete: committed timeframe,
   e.g. within 30 days of a written request].
6. **International transfers.** [Complete: data location(s), safeguards for transfers to Google (Gemini API,
   also used for speech-to-text) and Meta (WhatsApp Business Platform).]
7. **Audit.** The Processor makes available information reasonably needed to show compliance with this agreement
   and allows reasonable audits [once per year].
8. **Liability / governing law.** [Lawyer to complete.]
