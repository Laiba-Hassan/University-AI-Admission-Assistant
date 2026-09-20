# Sub-processor list (draft — confirm against final vendor choices)

| Sub-processor | Purpose | Data | Notes |
|---|---|---|---|
| Google (Gemini API) | Generates answers; embeddings; possibly speech-to-text | Message text/transcripts, retrieved university facts | **Paid tier only for real tenant data.** Confirm data-use and limited-retention terms in writing; note limited abuse-monitoring logs. Free tier = synthetic data only. |
| Supabase / hosting provider | Auth, PostgreSQL + pgvector | All platform data | Choose region deliberately. |
| Meta Platforms (WhatsApp Business Platform) | WhatsApp messaging | WhatsApp ID, message content, voice notes in transit | Meta's own terms apply. |
| Speech-to-text provider (TBD by bake-off) | Voice transcription | Audio, deleted after transcription | Confirm provider does not retain audio. |
| Email provider (Resend/Postmark) | Transactional email, alert fallback | Staff emails; alerts contain no student name/phone | |
| Sentry | Error monitoring | Technical data; scrub PII from events | Configure PII scrubbing. |
| Cloudflare | CDN, TLS, Turnstile bot protection | IP address, request metadata | |
