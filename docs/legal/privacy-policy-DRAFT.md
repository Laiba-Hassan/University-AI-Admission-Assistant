# Privacy Policy — DRAFT (not legal advice; lawyer review required before this is treated as final)

**Platform:** Enrollium ("we", "the platform"). We provide an AI admissions assistant to universities
("Universities"), embedded on their own websites and, where a University connects it, on WhatsApp.

## Who is responsible for your data

For students who chat with a University's assistant, **the University is the controller** and Enrollium acts as
its **processor**. For University staff accounts, and for a university's own sign-up request to join the
platform, Enrollium is the controller.

## What we collect

- **Messages you send** (text; and the transcript of voice notes/recordings). Audio is sent to our
  speech-to-text provider for transcription and **is never written to our database** — only the resulting text
  is stored, exactly like a typed message.
- **Details you choose to give**: name, phone/email, program interest, and your explicit consent, when you ask
  to be contacted (a "lead").
- **Technical data**: channel (web or WhatsApp), detected language, timestamps, an anonymous session id (web) or
  your WhatsApp ID (WhatsApp).
- **Staff data** (for University employees using the dashboard): email, role, notification preferences.

Before anything is stored, obvious personal identifiers (phone numbers, email addresses) inside a message's own
text are masked at the point of writing, and platform-admin/staff alerts never include a student's name or phone
number even when the underlying conversation does.

## How we use it

To answer your questions using only the University's own approved information (never inventing an answer), to
route your conversation to a staff member when you ask to speak with one or when the assistant cannot answer, and
to keep the service secure and working (rate-limiting abuse, monitoring for outages).

## Who we share it with

See [`subprocessors.md`](./subprocessors.md) for the current, factual list of every vendor and what each one can
see — kept up to date with what this platform actually integrates with, not an aspirational list. **We do not
sell personal data**, to anyone, ever.

If a University connects its own automation workflow (Settings → Automations), event notifications (e.g. "a new
lead came in") are delivered to a destination **the University itself configures and controls** — Enrollium
delivers to whatever URL the University enters, and is not a party to what that destination does with it.

## Retention and your rights

Each University sets its own retention period for conversation data (90 days by default for a newly approved
University; editable in that University's own Settings). After that window, conversations are deleted. You can
ask the University (or Enrollium directly, for staff account data) to export or delete data associated with you;
both are supported.

## Security

Every University's data is isolated at the database level by row-level security enforced on every query, not
just application-layer filtering — the same guarantee this platform's own multi-tenant test suite verifies on
every change. Access to a University's own dashboard is logged. Data is encrypted in transit (TLS) and, via our
hosting provider, at rest.

## Voice recordings, specifically

Per the above: a voice note or the web widget's mic recording is sent once to our speech-to-text provider,
transcribed, and the audio itself is discarded immediately after — it is never written to persistent storage,
never replayed by staff, and never used to train any model.

## Contact

[PRIVACY CONTACT EMAIL] · [REGISTERED ADDRESS] — placeholders until the entity operating this platform is
finalized; do not treat this document as complete or in force until those are filled in and it has had legal
review.

## Open items for the lawyer

Applicable law (relevant data-protection legislation in the platform's and each University's jurisdiction;
GDPR-style obligations for international students); cross-border transfer language for data sent to Google
(Gemini) and Meta (WhatsApp); children's/minors' data where an applicant is under the age of majority; Meta's own
WhatsApp Business terms as they apply to this integration; consent wording for lead capture; what happens to a
University's data on contract termination beyond "the University may export it first."
