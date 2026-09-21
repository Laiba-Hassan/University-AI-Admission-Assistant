# Phase 2 — Core Backend & Database: status

Exit condition (PRD §14): *API returns correctly tenant-scoped data and the isolation test passes in CI.*

| PRD deliverable | Status | Where |
|---|---|---|
| Migrations; RLS at creation with FORCE RLS, restricted app role, per-transaction tenant context | ✅ | `db/migrations/`, `apps/api/src/db.ts` (`withTenant` uses `set_config(..., true)` inside a transaction; the server refuses to start if its role is a superuser, has BYPASSRLS, or owns tables) |
| Express skeleton with tenant resolution: session, widget key, WhatsApp `phone_number_id` | ✅ | `apps/api/src/tenancy.ts`, `routes/staff.ts`, `routes/widget.ts`, `routes/whatsapp.ts` |
| pg-boss job queue | ✅ | `apps/api/src/queue.ts` (own `pgboss` schema, own `app_queue` role defined in `infra/init-roles.sql`, tenant id in every job). The consumer is a placeholder until Phase 6A |
| Seed flagship tenant | ✅ | `pnpm seed` loads both demo tenants from `/data` (deterministic tenant ids, dev widget keys `wk_dev_crescent_valley` / `wk_dev_nexora`, placeholder WhatsApp ids `test-phone-<subdomain>`) |
| Embed knowledge into pgvector | ✅ | Crescent Valley 42 chunks, Nexora 11 (documents chunked by heading, each FAQ its own chunk) |
| Start metering `usage_events` | ✅ | `recordUsage()`; currently meters `knowledge_search` and `widget_session`. Chat/message events arrive with Phase 3/4 |
| Cross-tenant isolation test in CI | ✅ | `.github/workflows/ci.yml` runs `db:test` (SQL) and `test` (44 API tests). **Not yet run on GitHub**: push the repo to see it go green there |

## Commands
```bash
pnpm db:up && pnpm db:migrate     # add -- --reset to start clean
pnpm seed                         # needs GEMINI_API_KEY in .env; embeddings are cached in .cache/
pnpm recall                       # embedding recall@3 on data/bakeoff/queries.jsonl
pnpm test                         # API-level isolation + WhatsApp routing + queue tests
pnpm api:dev                      # http://localhost:3001
```

## What the tests prove (`apps/api/test/`)
- For 10 tenant-owned resources, Tenant A's list contains only A's rows and B's rows are 404 by id. The staff routes have no app-side `tenant_id` filter on purpose, so these tests exercise RLS itself.
- Forged/expired/wrong-secret JWT, a user with no membership, and `X-Tenant-Id` pointing at another tenant all fail; a `tenant_id` in the query string is ignored.
- Widget: key + origin must both match; a tenant's key from another tenant's origin, a missing origin, an unknown key and a revoked key all give the same 403.
- Tenant context does not leak across pooled connections; A cannot insert, update or delete B's rows; identical embeddings in two tenants still return only the caller's chunk.
- WhatsApp: signed message routes to the owning tenant; missing/wrong signature enqueues nothing; unknown or suspended tenant's number is ignored.

## Things to know
- **Staff auth is verified but not yet wired to Supabase.** The API verifies a Supabase-style JWT (`SUPABASE_JWKS_URL` for staging, or `SUPABASE_JWT_SECRET`). Creating users, login UI, and linking `tenant_users.auth_user_id` are Phase 5. No staff user is seeded.
- **Job payloads are outside RLS.** `pgboss.job` holds inbound WhatsApp payloads (student text, phone number) and is not tenant-isolated. It is reachable only by the queue role and kept 1 day after completion. Before Phase 6A, better to store the inbound message in `messages` (under RLS) first and enqueue only ids; decide then.
- **Not in Phase 2 by design:** rate limits, Turnstile, monthly caps (Phase 4); webhook idempotency and delivery (6A).
- `pnpm seed` deletes and recreates the two demo tenants (including their conversations); it refuses to run with `NODE_ENV=production`.
- Fixed a leftover wrong university name ("Meridian") in the Urdu welcome message in `data/crescent-valley/tenant.json`; a native speaker should still review all Urdu strings.
- `.env` holds a real `GEMINI_API_KEY`; it is gitignored, but it appeared in this session's tool output, so rotating it is cheap insurance. `.env.example` documents all variables.
