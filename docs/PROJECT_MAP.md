# Project Map — University AI Admission Assistant ("Enrollium")

One file that ties the whole codebase together: what each phase built, which files it created or touched, how
those files connect to each other at runtime, and the structural patterns used throughout. Written from the
actual repo (file listing, migration list, git history) as it stands today, not from memory.

For deeper narrative on Phases 1–4 specifically, see `docs/PHASE1_STATUS.md` … `PHASE4_STATUS.md` — this file
summarizes those and covers Phases 5–8 in full (no separate status docs exist for those yet).

---

## 1. What this is

A multi-tenant SaaS: universities embed an AI admissions assistant on their own website and, optionally,
WhatsApp. It answers prospective-student questions **only** from that university's own approved data (programs,
fees, intakes, requirements, scholarships, FAQs), captures leads, and hands off to staff on request or when it
can't answer. A staff dashboard manages all of that per university, and a separate Super Admin surface lets a
platform operator approve new universities and see across all of them.

**Everything is TypeScript** — no Python anywhere, by standing project rule.

## 2. Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`).

| Path | What it is | Tech |
|---|---|---|
| `apps/api` | The backend — one Express app serving the widget, WhatsApp webhook, staff dashboard, platform-admin, and desktop app | Express, `pg` (raw SQL, no ORM), `pg-boss` (queue), Zod |
| `apps/dashboard` | Staff dashboard **and** Super Admin dashboard (same Next.js app, different route trees) | Next.js App Router, Tailwind, Supabase Auth client |
| `apps/widget` | The embeddable chat widget (loader script + iframe UI) | Preact, esbuild (no framework bundler) |
| `apps/web` | The public demo university website (Crescent Valley University) that embeds the widget | Next.js App Router, statically generated |
| `apps/desktop` | Windows desktop wrapper around the staff dashboard | Electron, electron-builder, electron-updater |
| `packages/shared` | Zod schemas for the seed-data JSON shape, shared between the seed script and `validate:data` | TypeScript, Zod |
| `db/migrations` | Every schema change, in order, applied by `scripts/migrate.mjs` | Raw SQL |
| `db/tests` | The RLS cross-tenant isolation proof, run directly against Postgres | SQL |
| `data/<tenant>/` | Hand-curated demo content for each seeded tenant (`crescent-valley`, `nexora`) — the actual source of truth the seed script loads and the website statically renders from | JSON + Markdown |
| `infra` | Database role definitions (`app_user`, `app_migrator`, `app_queue`, `app_resolver`) | SQL |
| `docs` | Phase status docs, architecture decisions, legal drafts, this file | Markdown |
| `scripts` | `migrate.mjs`, `db-test.mjs` — thin Node runners, no framework | JS |
| `.github/workflows/ci.yml` | CI: typecheck, tests, RLS isolation, eval smoke set, production builds, load test, desktop build | GitHub Actions |

## 3. Core architectural patterns (used everywhere, explained once)

These recur across almost every phase below — understanding them once makes the rest of this file much shorter.

### 3.1 Multi-tenancy via Postgres Row-Level Security, not app-layer filtering
Every tenant-owned table has RLS **enabled and forced** (`db/migrations/0001_schema.sql`), keyed on
`current_tenant_id()`, which reads a per-transaction setting (`app.tenant_id`) the app sets with `SET LOCAL`
(`apps/api/src/db.ts`'s `withTenant()` — clears automatically at transaction end, can't leak across a pooled
connection). The app's own DB role (`app_user`) has no `BYPASSRLS` and owns no tables it queries, so this can't
be bypassed by an app bug the way a forgotten `WHERE tenant_id = ...` could. **Staff routes deliberately never
add their own tenant filter** — they rely on RLS itself, so the tests exercise the real guarantee.

### 3.2 Resolving a tenant *before* any tenant context exists
A handful of lookups necessarily run before the app knows which tenant it's talking to: a widget key, a
WhatsApp `phone_number_id`, a staff member's auth token, a platform admin's auth token. Each is a narrow
`SECURITY DEFINER` SQL function owned by a separate, deliberately-privileged `app_resolver` role (`NOLOGIN
BYPASSRLS`) — the *only* place RLS is bypassed, and each function does exactly one unforgeable lookup. See
`resolve_tenant_by_widget_key`, `resolve_tenant_by_phone_number_id`, `resolve_tenants_by_auth_user` (migration
0001), `is_platform_admin` (0012), `platform_list_tenants` (0013/0015). The Express side:
`apps/api/src/tenancy.ts` — `resolveWidgetTenant`, `resolveStaffTenant`, `resolvePlatformAdmin`.

### 3.3 Dependency-injection seams for every external service
Nothing in `apps/api/src` talks to a real external API without going through a small interface that a test (or
the load test) can swap for a fake:
- `LlmProvider` (`agent/llm.ts`) — Gemini chat completions
- `SttProvider` (`voice/transcribe.ts`) — Gemini speech-to-text
- `ChallengeVerifier` (`challenge.ts`) — Cloudflare Turnstile
- `WhatsAppSender` (`whatsapp/send.ts`) — Meta Graph API
- `AiExtractProvider` (`ai-import.ts`) — Gemini for AI-assisted import
- `PushSendFn` (`push.ts`) — web-push
- `WebhookSendFn` (`automations.ts`) — a tenant's own automation endpoint

All wired through `createApp(enqueue, challenge?, llmProvider?, sttProvider?)` in `app.ts`, so `apps/api/test/*`
and `apps/api/load-test/run.ts` exercise the real routing/DB/RLS logic without spending real API quota or
needing live credentials.

### 3.4 Verify-then-reveal (the answer pipeline)
`agent/conversation.ts`'s `handleMessage()` is the one core every channel (web, WhatsApp text, WhatsApp voice,
the web mic) calls. It: loads context → runs the agent (`agent/agent.ts`, tool-calling loop against
`agent/tools.ts`) → **verifies** the reply (`agent/verifier.ts`: every number/date/percent in the reply must
trace back to this turn's tool results, retrieved knowledge, or the student's own words) → only then persists
and returns it. An unverifiable reply is replaced with a safe fallback, never shown. The widget's own "reveal"
animation (`widget.tsx`) is purely cosmetic pacing of an *already-verified* reply — verification is server-side
and complete before anything reaches the client.

### 3.5 The widget never calls the API directly
`apps/widget/src/loader.ts` (runs unsandboxed in the host page, so its `fetch()` calls carry the host page's
real origin — what the tenant's widget key is allow-listed against) ↔ `protocol.ts` (the `postMessage` message
shapes) ↔ `rpc.ts` (the iframe's side of the relay) ↔ `widget.tsx` (the UI, which only ever calls `rpc()` /
`rpcBinary()`, never `fetch()`). This is why a widget key's `allowed_origins` check actually means something even
though the iframe itself is served from one shared origin regardless of which university embeds it.

### 3.6 PII masking and no-leak alerts
Obvious identifiers (phone, email, CNIC, card numbers) in a student's own message text are masked
(`agent/pii.ts`) before the message is ever written to storage. Staff-facing alerts (`alerts.ts`, `push.ts`)
never include a student's name or phone number even though the underlying conversation record does.

---

## 4. Phase-by-phase

### Phase 1 — Foundations, Decisions & Data
*Full detail: `docs/PHASE1_STATUS.md`.* Commit: `e75a401`.

Built: the two demo tenants' hand-curated content (`data/crescent-valley/`, `data/nexora/` — JSON + Markdown,
deliberately structurally different from each other: per-semester vs. per-credit-hour fees, single vs.
multi-campus), the full DB schema (`db/migrations/0001_schema.sql`), DB roles (`infra/init-roles.sql`), the RLS
isolation proof (`db/tests/rls_isolation.sql`), the monorepo skeleton (`packages/shared` — Zod schemas +
`validate-data.ts`, which every later phase's seed data is checked against), and starting legal drafts
(`docs/legal/`).

### Phase 2 — Core Backend & Database
*Full detail: `docs/PHASE2_STATUS.md`.* Commit: `e2fbaae` (combined with Phase 3).

Built: `apps/api/src/db.ts` (the `withTenant`/`withoutTenant` pattern, §3.1 above), `tenancy.ts` (widget-key and
WhatsApp resolvers), the Express skeleton (`app.ts`, early `routes/`), `queue.ts` (pg-boss, placeholder consumer
until Phase 6A), the seed script (`seed/seed.ts` — loads `/data` into Postgres + embeds knowledge into
pgvector), `usage.ts` (the start of `usage_events` metering), and the CI isolation-test job.

### Phase 3 — AI Agent, Guardrails & Evaluation
*Full detail: `docs/PHASE3_STATUS.md`.* Commit: `e2fbaae`, `d9a6592`.

Built: the whole `apps/api/src/agent/` directory — `agent.ts` (tool-calling loop), `tools.ts` +`facts.ts`
(`search_knowledge`, `lookup_facts` computing figures in code so the model never does arithmetic,
`capture_lead`, `request_human`), `prompt.ts` (the guarded system prompt), `verifier.ts` (§3.4), `pii.ts`,
`language.ts` (reply-language detection/matching), `conversation.ts` (`handleMessage()`, the shared core every
channel later reuses), `llm.ts` (`LlmProvider`/`GeminiProvider`, §3.3), `routes/chat.ts` (`POST /api/chat`, web
only at this point), and the whole `apps/api/eval/` harness (dataset built from `/data` itself, not hand-typed;
native-speaker review tooling).

### Phase 4 — Demo Website & Web Widget
*Full detail: `docs/PHASE4_STATUS.md`.* Commits: `aa3e10b`, `c2e94d3`, `f76f6ce`, `8a26131`.

Built: backend hardening for public reachability (`ratelimit.ts`, `routes/rate-limit-middleware.ts`,
`challenge.ts`, `cors.ts`, monthly/token caps in `conversation.ts`), the whole `apps/widget/` package (§3.5:
`loader.ts`, `protocol.ts`, `rpc.ts`, `widget.tsx`, `working-hours.ts` for the after-hours banner), and
`apps/web/` — the 8-page statically-generated demo site (`src/lib/content.ts` reads the *same* `/data` files the
seed script does, so the static pages can never drift from what the chat widget answers; `WidgetEmbed.tsx` adds
the loader script site-wide).

### Phase 5 — Staff Dashboard
Commits: `f8aed64`, `93373d7`, `90c081a`, `1a491e5`, plus a later fidelity pass (`a6cc85b`, `cb162ea`).

Built the entire `apps/dashboard` app's tenant-facing side:
- **Auth**: `src/lib/supabase.ts` (client), `src/lib/session.ts` (`useStaffSession` — exchanges a Supabase
  session for tenant/role via `GET /api/v1/me`), `app/sign-in`, `sign-up`, `forgot-password`, `reset-password`,
  `accept-invite` pages; backend side `apps/api/src/invites.ts`, `routes/public-staff.ts`
  (`POST /api/public/access-requests`, `POST /api/public/invites/accept`).
- **Shell**: `components/Sidebar.tsx`, `app/(dashboard)/layout.tsx` (auth guard), `lib/alerts.ts`
  (`useAlerts` — 5s poll for new leads/handoffs, toasts + sidebar badges).
- **Pages**: Overview (`(dashboard)/page.tsx` + `overview.ts`, `Kpi.tsx`, `TrendCharts.tsx`), Conversations +
  Inbox (`conversations.ts`), Leads (`leads.ts`), Unanswered (`unanswered.ts`), Knowledge Base + its approval
  workflow (`kb.ts`, `kb-entities.ts`) and CSV/JSON bulk import (`import.ts`), Settings (branding, messages,
  retention, team, usage — `settings.ts`).
- **RBAC**: `requireRole("admin"|"editor"|"viewer")` (`tenancy.ts`) enforced on every mutating route.
- **PWA**: `public/service-worker.js`, `components/InstallPrompt.tsx`, `ServiceWorkerRegister.tsx`.
- A later fidelity pass matched the dashboard's visuals pixel-for-pixel against the `references/` design PDFs
  (sparklines, trend deltas, fee-table staleness flags).

### Phase 6A — WhatsApp (text)
Commits: `05c2cf8`, `71409b4`.

Built: `whatsapp/send.ts` (`WhatsAppSender`, §3.3), `whatsapp/connection.ts` (guided manual connect — Meta
Embedded Signup needs Tech Provider approval this project doesn't have, so an admin pastes credentials from
their own Meta dashboard; access token encrypted via `secrets.ts`), `whatsapp/process.ts`
(`processWhatsAppChange()` — replay-protected via `messages.channel_message_id` uniqueness, routes text through
the *same* `handleMessage()` web chat uses), `whatsapp/staff-reply.ts` (24-hour-window free-text vs. approved-
template delivery), `routes/whatsapp.ts` (the signed webhook receiver), `queue.ts` rewritten with a real
consumer, `push.ts` (web-push desktop notifications for new leads/handoffs, `claim_push_events()` migration
0009/0011), and the Settings → Channels UI (`app/(dashboard)/settings/channels/page.tsx`).

### Phase 6B — Voice
Commit: `d00a16b`.

Built: `apps/api/src/voice/` — `convert.ts` (ffmpeg-static, normalizes to Ogg/Opus, probes duration from
ffmpeg's own stderr since no ffprobe is bundled), `transcribe.ts` (`SttProvider`/`GeminiSttProvider` — resolved
the PRD's open STT decision as Gemini, since it needs no second vendor and covers English/Roman
Urdu/Urdu in one model), `whatsapp-media.ts` (Meta's two-hop media download), `pipeline.ts`
(`processVoiceMessage()` — shared by both channels, duration-gated before ever spending a transcription call).
`conversation.ts` gained `content_type`/`audio_seconds`. `whatsapp/process.ts` gained voice-note handling.
`routes/chat.ts` gained `POST /api/chat/voice`. On the widget side: `protocol.ts`/`loader.ts`/`rpc.ts` gained
binary-body relay (`rpcBinary`, a real `ArrayBuffer` over `postMessage`, not base64), and `widget.tsx` gained
the mic button, recording state, and the voice-privacy welcome notice (later removed per user request).

### Phase 7 — Access Control, Automations, Super Admin, Onboarding, Import, Desktop App
The biggest phase; seven commits (`d09cbb2` → `6ac554b`), each a coherent sub-slice:

**Part 1 — platform-admin auth + access-request approval** (`d09cbb2`). `db/migrations/0012` (`platform_admins`
table, `is_platform_admin()`), `tenancy.ts` gained `resolvePlatformAdmin`, new `routes/platform.ts` (mounted at
`/api/platform`): reviewing `access_requests`, approving one creates the real tenant (a self-generated id set as
its own tenant context first satisfies the existing `tenants` RLS `WITH CHECK` without any bypass — the same
trick `seed.ts` uses under a different role) plus `tenant_limits` and a nullable-`invited_by` admin invite
reusing `settings.ts`'s existing `inviteStaff()`.

**Part 2 — automation webhooks** (`c461c3f`). `automations.ts` + `db/migrations/0014`: a per-tenant
`automation_settings.webhook_url`, `claim_automation_events()` (a *separate* claim path from
`claim_push_events()`, since a webhook consumer needs every event type independently of whether push already
"used up" the row), `maybeEmitLimitWarning()` wired into `conversation.ts`'s two block points,
`generateDailyUsageReports()`. Dashboard: `settings/automations/page.tsx`.

**Part 3 — Super Admin backend** (`8381142`). `db/migrations/0015`: `tenant_billing` (manual price/cycle/
payment-status tracking, no real payment gateway), `tenant_support_notes`, `sub_processors`,
`platform_settings`, `platform_audit_log`. `platform.ts` gained editable usage limits, billing, support notes,
`GET /billing` (MRR/ARR/failed-payments), `GET /usage-cost` (real 30d token/cost rollup, labeled an estimate),
`GET /health` (real DB/queue reachability; explicitly *not* fabricating uptime history since no APM exists),
sub-processor CRUD, global settings, the audit log.

**Part 4 — Super Admin frontend** (`3a703af`). The whole `app/platform/` route tree + `platform-sign-in`:
`lib/platform-session.ts`, `components/PlatformSidebar.tsx`/`PlatformHeader.tsx`, and one page per backend
surface above (`tenants`, `tenants/[id]`, `usage-cost`, `billing`, `support`, `health`, `settings`,
`audit-log`) — reusing the tenant dashboard's exact design system rather than a second visual language.

**Part 5 — web widget key setup, onboarding wizard, 2 RBAC fixes** (`4aae9ea`). `settings.ts` gained
`ensureWidgetKey`/`setWidgetOrigins`/`rotateWidgetKey` (previously: no tenant had any way to get a widget key at
all outside the seed script). `onboarding.ts` + `db/migrations/0016`
(`tenants.onboarding_completed_at`) + `app/(dashboard)/onboarding/page.tsx` (a guided checklist over real data:
knowledge/branding/channels status, a live test-chat panel reusing the KB editor's own `/api/v1/kb/test-chat`).
Fixed: leads CSV export had no RBAC gate (any role could bulk-export PII); a stuck-`human`-status bug in the KB
test-chat scratch conversation.

**Part 6 — AI-assisted import** (`8fccd5f`). `ai-import.ts` (`AiExtractProvider`/`GeminiAiExtractProvider` — free
text → rows shaped exactly like a CSV upload's parsed rows) + `routes/staff.ts`'s
`POST /api/v1/import/ai-extract`, feeding the *same* `validateRows`/`createImportBatch`/review pipeline Phase 5
built — an AI-extracted row gets exactly as much human review as a hand-built CSV row. Dashboard:
`knowledge-base/import/page.tsx` gained a mode toggle.

**Part 7 — Windows desktop app** (`6ac554b`). The whole `apps/desktop/` package (§2 table): `src/main.ts` (tray,
close-to-tray, `electron-updater` against this repo's GitHub Releases, pre-grants notification permission for
the dashboard's own origin), `src/config.ts` (`ENROLLIUM_DASHBOARD_URL`). Desktop notifications needed **no**
Electron-specific dashboard code — `lib/alerts.ts`'s existing poll just also calls the standard `Notification`
API. `app/download/page.tsx` (install instructions). Also: Settings → Retention's data export extended from
conversations+leads only to every KB entity, via the existing generic `/api/v1/:resource` route.

### Phase 8 — Hardening & Compliance
Commit: `0dc4e3a`.

Built: `apps/api/load-test/run.ts` (`pnpm load-test` — concurrent virtual users across several tenants against
a fake `LlmProvider`, deliberately not real Gemini; realistic per-user pacing so it measures backend capacity
rather than tripping the per-session rate limit; a warm-up phase pre-populates the embeddings cache so a
one-time real-API cost for the test's fixed question pool isn't misread as a capacity problem). That test
surfaced a real bottleneck — `db.ts`'s Postgres pool was hardcoded at `max: 10`; made configurable
(`config.ts`'s `DB_POOL_MAX`, default raised to 20). `.github/workflows/ci.yml` gained production-build steps
for all three frontend apps, the load test as a gated step, and a `windows-latest` job building the (unsigned)
desktop installer. `docs/legal/` — all docs updated to match what's actually built (not aspirational), a new
Terms of Service draft and Security Overview, and all four published as live pages at `apps/dashboard/src/app/
legal/{privacy,terms,security}` (`components/LegalDoc.tsx`) — reachable, not just files in a docs folder, each
honestly marked as a draft awaiting real legal review.

### Phase 9 — External Security Review & Launch Packaging
**Not done, by design** — its exit condition ("external review findings closed, client could be handed the
product today with zero custom work required") depends on things outside what a coding session can do: booking
and paying for a third-party penetration test, and purchasing/registering a Windows code-signing certificate
(explicitly flagged in `apps/desktop/README.md` and `docs/legal/security-overview.md` rather than silently
skipped).

---

## 5. Database — migrations in order

| Migration | What it added |
|---|---|
| `0001_schema.sql` | The whole base schema: tenants, tenant_users, staff_invites, widget_keys, channel_connections, all KB tables (programs/faculties/campuses/fee_items/intakes/requirements/scholarships/faqs), knowledge_documents/knowledge_chunks (pgvector), contacts/conversations/messages, leads, unanswered_questions, usage_events, audit_logs, event_outbox, data_requests, push_subscriptions, access_requests. RLS + FORCE RLS on every tenant table via a loop; the three original resolver functions (§3.2). |
| `0002_tighten_faq_link.sql` | Tightened `unanswered_questions.linked_faq_id`'s tenant scoping. |
| `0003_rate_limits.sql` | Backing table for `ratelimit.ts`'s sliding-window counters. |
| `0004_accept_invite.sql`, `0005_invite_accept_grants.sql`, `0006_fix_accept_invite_ambiguity.sql` | `accept_staff_invite()` and a real bug fix: an OUT-parameter shadowing a real column name (the same bug class recurred later in migration 0011). |
| `0007_kb_fidelity_columns.sql` | Columns needed for dashboard fee-table staleness/fidelity (Phase 5 polish pass). |
| `0008_conversation_handoff_reason.sql` | `conversations.handoff_reason`. |
| `0009_push_notification_claim.sql`, `0010_push_subscriptions_unique.sql`, `0011_fix_claim_push_events_ambiguity.sql` | Web push (Phase 6A): `claim_push_events()`, a missing `UNIQUE` constraint fix, and the same OUT-parameter bug class fixed again. |
| `0012_platform_admins.sql` | `platform_admins` table, `is_platform_admin()` (Phase 7 part 1). |
| `0013_platform_tenant_listing.sql` | `platform_list_tenants()`, `platform_set_tenant_status()` (Phase 7 part 1). |
| `0014_automation_webhooks.sql` | `automation_settings`, `claim_automation_events()` (Phase 7 part 2). |
| `0015_platform_billing_support_audit.sql` | `tenant_billing`, `tenant_support_notes`, `sub_processors`, `platform_settings`, `platform_audit_log`; replaces `platform_list_tenants()` to also carry billing columns (Phase 7 part 3). |
| `0016_onboarding.sql` | `tenants.onboarding_completed_at` (Phase 7 part 5). |

## 6. How the pieces connect — request traces

**A student asks a question on the university website:**
`apps/web` page (embeds `WidgetEmbed.tsx`) → widget `loader.ts` iframe → `widget.tsx` UI → `rpc.ts` →
`postMessage` → `loader.ts`'s real `fetch()` (host-page origin) → `POST /api/chat` (`routes/chat.ts`) →
`resolveWidgetTenant` (`tenancy.ts`, §3.2) → `handleMessage()` (`agent/conversation.ts`, §3.4) → `runAgent()`
(`agent/agent.ts`) → tools (`agent/tools.ts`/`facts.ts`, RLS-scoped queries) → `verifyReply()`
(`agent/verifier.ts`) → persisted to `messages` → reply flows back through the same chain → widget reveals it.

**A student sends a WhatsApp voice note:**
Meta webhook → `routes/whatsapp.ts` (signature-verified) → `queue.ts` (pg-boss) →
`whatsapp/process.ts`'s `handleWhatsAppVoiceNote()` → `voice/whatsapp-media.ts` (two-hop download) →
`voice/pipeline.ts` → `voice/transcribe.ts` (Gemini) → `handleMessage()` (same core as above) →
`whatsapp/send.ts` sends the reply back.

**Staff approves a Knowledge Base draft:**
Dashboard `knowledge-base/page.tsx` → `PATCH /api/v1/kb/:entity/:id/approve` (`routes/staff.ts`) →
`requireRole("admin","editor")` → `kb.ts`'s `approveKbRow()` (RLS-scoped) → row written to `audit_logs`.

**A platform admin approves a new university:**
`platform-sign-in` → `platform/tenants` (`lib/platform-session.ts` checks `GET /api/platform/me`) →
`POST /api/platform/access-requests/:id/approve` (`routes/platform.ts`) → generates a tenant id, sets it as
this transaction's own context, inserts `tenants`+`tenant_limits`, calls `settings.ts`'s `inviteStaff()` →
`platform_audit_log` row written → the new admin later visits `accept-invite`, signs in, and lands on
`onboarding.ts`'s checklist.

**Desktop app notification:**
`apps/desktop/src/main.ts` opens a `BrowserWindow` on the real dashboard URL → the loaded page is 100% the
normal `apps/dashboard` code → `lib/alerts.ts`'s 5s poll (`GET /api/v1/alerts`) fires the standard
`Notification` API — no Electron-specific dashboard code involved.

## 7. Commands

```bash
pnpm install
pnpm db:up && pnpm db:migrate && pnpm seed     # Postgres + pgvector in Docker, schema, demo data
pnpm validate:data                             # /data shape + PRD hard-case checks
pnpm typecheck                                 # all 6 packages
pnpm test                                      # API (node:test) + widget unit tests
pnpm db:test                                   # RLS cross-tenant isolation, direct SQL
pnpm load-test                                 # concurrent-load pass/fail against a fake LLM provider

pnpm api:dev                                   # :3001 — the one backend for everything
pnpm dashboard:dev                             # :3002 — staff dashboard AND Super Admin (/platform/*)
pnpm widget:dev                                # :5174 — loader.js + widget bundle
pnpm web:dev                                   # :3000 — the demo university website

pnpm --filter @uaa/desktop dev                 # Electron wrapper (needs dashboard:dev running)
pnpm --filter @uaa/desktop build               # real NSIS installer, unsigned (apps/desktop/README.md)

pnpm --filter @uaa/api eval -- --tenant crescent-valley --set smoke   # ~19-case eval against real Gemini
pnpm recall                                    # embedding recall@3 sanity check
```

Ports at a glance: **3001 = API only (JSON, no pages)**, **3002 = the one Next.js dashboard app** (staff
dashboard at `/`, Super Admin at `/platform-sign-in` → `/platform/*`, legal pages at `/legal/*`, desktop-app
download at `/download`), **3000 = the public demo website**, **5174 = the widget's own dev server**.
