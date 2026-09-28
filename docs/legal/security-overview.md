# Security Overview

A factual description of this platform's security posture, for a University's own security review before
onboarding. Written from the actual implementation, not aspirational — where something isn't built yet, this
document says so rather than implying otherwise.

## Multi-tenant data isolation

Every tenant-owned table has row-level security **enabled and forced** in Postgres, keyed on a tenant context
the application sets per request/transaction (`SET LOCAL`, cleared automatically at transaction end — it can
never leak between requests sharing a pooled connection). The database role the application connects as has no
`BYPASSRLS` attribute and does not own the tables it queries, so this isolation cannot be bypassed by an
application bug the way an app-layer `WHERE tenant_id = ...` filter could be forgotten. This exact guarantee —
that tenant A's data is structurally unreachable from tenant B's request — is exercised directly by this
project's own automated test suite on every change (not just asserted in documentation), including specific
"tenant A and tenant B ask the same question, each gets their own answer" tests across the web widget, WhatsApp,
and voice channels.

A handful of resolution paths (a widget key's tenant, a WhatsApp phone number's tenant, a user's tenant
memberships) necessarily run *before* any tenant context exists; those are narrow, single-purpose SQL functions
owned by a separate, deliberately-privileged database role, each doing exactly one unforgeable lookup (by an
origin-checked widget key, a Meta-verified webhook phone number, or a cryptographically verified JWT subject) —
never trusting a client-supplied tenant id.

## Authentication

- **Staff and platform-admin accounts** authenticate via Supabase Auth; the API verifies the resulting JWT
  against Supabase's own JWKS endpoint (or the shared secret, in local development) on every request.
- **Role-based access control**: three roles (Admin, Editor, Viewer) per tenant, enforced server-side on every
  route that needs it — never assumed from what the dashboard's UI happens to show. Verified by this project's
  own tests for every role-gated action (e.g., an Editor cannot invite staff; a Viewer cannot bulk-export leads
  or change a lead's status, matching what edit access actually requires).
- **Platform admins** are a wholly separate identity from any tenant's staff — a platform admin is never
  implicitly a member of any tenant, and the reverse is also true.

## Data in transit and at rest

TLS in transit (via the hosting/CDN layer). At rest, encryption depends on the hosting provider's own database
encryption (Postgres via Supabase or equivalent). Secrets stored in the database itself (WhatsApp access tokens)
are additionally encrypted at the application layer (AES-256-GCM) before being written, and are never returned
to the client once saved — the settings API only ever echoes back a masked form.

## PII handling

Obvious personal identifiers (phone numbers, email addresses) found inside a student's own message text are
masked before that message is ever written to storage. Staff-facing alerts (new lead, handoff requested) never
include a student's name or phone number, even though the underlying conversation record does, for a staff
member who opens it directly.

## Voice data

Voice recordings (WhatsApp voice notes, the web widget's mic button) are sent once to the speech-to-text
provider for transcription and are **never written to persistent storage** — only the resulting transcript is
saved, identically to a typed message.

## Abuse protection

- Rate limiting per IP, per tenant, and per chat session (see `config.ts`'s `RATE_LIMIT_*` values), enforced on
  every public chat request.
- A bot challenge (Cloudflare Turnstile, tenant-configurable; a permissive fallback exists for local development
  only) gates the public web widget's first message in a session.
- Every AI-generated reply is checked against the University's own stored facts and the retrieved knowledge
  before being shown to a student — an answer the verifier can't support is replaced with a safe fallback rather
  than shown, which is also how a potential prompt-injection attempt embedded in retrieved content is contained
  (it cannot make the assistant assert an unsupported fact, because unsupported facts are rejected regardless of
  why the model produced them).

## What is not yet built (do not represent these as in place)

- **No error-tracking/APM integration** (e.g. Sentry) exists yet. The Super Admin "Platform Health" page reports
  this honestly (real database reachability and queue depth; explicit "not configured" for error tracking)
  rather than fabricating uptime history or an incident feed.
- **No independent third-party penetration test has been performed.** Booking one is a real-world, paid
  engagement outside what this document or an AI assistant can arrange or certify — it remains an open item for
  whoever operates this platform before a genuine security-sensitive launch.
- **The Windows desktop app's installer is not code-signed.** A real code-signing certificate is a purchase and
  identity-verification process outside what can be completed here; see `apps/desktop/README.md`.
- **In-app billing/payment processing is not built.** Billing today is tracked manually by the platform
  operator; no payment card is charged automatically by this platform.

## Reporting a security issue

[SECURITY CONTACT EMAIL] — placeholder until the operating entity is finalized.
