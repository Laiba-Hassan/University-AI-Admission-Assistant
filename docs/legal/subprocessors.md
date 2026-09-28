# Sub-processor list

Reflects what this codebase actually integrates with today, not a target architecture. Reviewed alongside every
Phase; last updated for Phase 8. See [`privacy-policy-DRAFT.md`](./privacy-policy-DRAFT.md) and
[`dpa-template-DRAFT.md`](./dpa-template-DRAFT.md) for how this list is referenced contractually.

| Sub-processor | Purpose | Data | Status |
|---|---|---|---|
| Google (Gemini API) | Generates chat answers; embeddings for knowledge retrieval; **also** speech-to-text for voice notes (both WhatsApp and the web widget's mic button) -- one vendor covers both, resolved from the PRD's originally-open "STT provider" decision. | Message text, voice audio (only for the duration of the transcription call -- **never stored**), retrieved university facts | Live |
| Supabase | Staff/platform-admin authentication (Supabase Auth); JWTs verified against its JWKS endpoint. Also the intended Postgres + pgvector host in production (self-hosted Docker Postgres locally in development). | Staff email, auth tokens; all platform data if also used as the DB host | Live (auth) / deployment-dependent (DB hosting) |
| Meta Platforms (WhatsApp Business Platform, Cloud API) | WhatsApp messaging: receiving and sending text and voice-note messages | WhatsApp phone-number ID, message content, voice notes in transit | Live, per tenant that connects a WhatsApp number |
| Cloudflare Turnstile | Bot/abuse protection on the public web widget's chat endpoint | IP address, request metadata | Supported per-tenant (`turnstile_site_key`); a tenant that hasn't configured a real site key runs on a permissive local/dev fallback, not Turnstile |
| A tenant's own automation webhook destination (their choice: n8n, Zapier, Make, etc.) | Delivers conversation events (new lead, handoff requested, unanswered question, limit warning, daily usage report) so the tenant can wire up email/Slack/spreadsheet workflows on their own end | Event type, timestamp, and the same non-PII payload already masked in this platform's own storage (no student name/phone) | Tenant-configured and tenant-controlled (Settings > Automations); this platform does not choose or vet what a tenant points it at |

## Not currently integrated (do not represent these as live)

- **Error monitoring / APM (e.g. Sentry).** Not wired up. Platform Health in the Super Admin dashboard says so
  explicitly rather than fabricating uptime/incident data. Add a real row here (and update the privacy policy
  and this platform's own Platform Health page) the day one is actually integrated.
- **Transactional email provider.** Staff invites currently generate a one-time token returned directly to the
  inviting admin (no email is sent by this platform); a new tenant's approval likewise doesn't send an email
  itself. Delivering that over email is the kind of thing a tenant's own automation webhook (see above) can be
  wired up to do, or a first-party email provider would need to be added and listed here before this platform
  claims to send email on a University's behalf.
