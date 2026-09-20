# Phase 1 — Foundations, Decisions & Data: status

Exit condition (PRD §14): *Clean /data folder ready to seed, schema finalized, accounts active, Meta verification submitted, STT and embedding choices recorded, decisions recorded.*

Legend: ✅ done in this repo · 🟡 scaffolded, needs your input · 🔴 needs you (outside the codebase)

| # | PRD deliverable | Status | Where / what's left |
|---|---|---|---|
| 1 | Hand-curated flagship demo data (JSON + Markdown, hard cases) | ✅ | `data/crescent-valley/` — 3 faculties, 13 programs, 2 campuses, 26 fee items, 3 intakes, 6 scholarships, 30 FAQs, 10 documents. `pnpm validate:data` proves the §1.1 hard cases exist. |
| 2 | Second tenant, structurally different | ✅ | `data/nexora/` — single campus, **per-credit-hour** fees, own scholarships/branding. BSCS differs across tenants (needed for the multi-tenant acceptance test). |
| 3 | Full DB schema (§4), `tenant_id` everywhere, RLS | ✅ (⚠ see note) | `db/migrations/0001_schema.sql`, roles in `infra/init-roles.sql`, isolation test `db/tests/rls_isolation.sql`. |
| 4 | Provision Postgres + pgvector, monorepo, environments | 🟡 | Monorepo (`pnpm`, `packages/shared`) and `docker-compose.yml` (pgvector/pg16) done. Hosted Postgres/Supabase project, staging env: 🔴 you. |
| 5 | All required accounts | 🔴 | See list below. |
| 6 | Meta readiness | 🟡 | No business entity, so business verification is **deferred**. Use Meta's free test number (enough for Phases 6A/6B). Create the developer app(s) now: `docs/meta-readiness-checklist.md`. |
| 7 | 30+ voice notes, 100+ Roman Urdu/Urdu messages, STT + embedding bake-offs | 🟡 | Protocol, formats and starter set in `docs/bakeoff-plan.md`, `data/bakeoff/`. Recording and native-speaker writing: 🔴 you. |
| 8 | Lock open decisions (WhatsApp route, STT provider) | 🟡 | Recommendations in `docs/decisions.md`; WhatsApp route is now decided (Cloud API + test number); STT provider needs the bake-off. |
| 9 | Start privacy policy + DPA drafts | ✅ drafts | `docs/legal/` — starting drafts only; a lawyer must review. |

## Accounts to open (🔴 you)
Supabase (Auth + Postgres) · Google AI Studio/Cloud with **billing enabled** (paid Gemini tier before any real tenant data) · Meta developer app (test number; no verification) · Resend or Postmark · Cloudflare (Turnstile + DNS) · Sentry · Render/Railway/Fly.io · GitHub · Google Cloud Speech-to-Text or an OpenAI key (only if these STT options win the bake-off).

## Schema design notes worth knowing
- **Cross-tenant references are impossible at the DB level**: child tables use composite FKs `(tenant_id, parent_id)`, so a fee can't point to another tenant's program even with a bug in app code.
- **Tenant lookup before context exists** (widget key, `phone_number_id`, staff login) uses three narrow `SECURITY DEFINER` functions owned by a `NOLOGIN BYPASSRLS` role. That is the only RLS bypass in the system and each returns just a tenant id.
- **Additions to PRD §4** (needed to make the PRD's own rules work): `program_campuses` (which campus offers which program — required for the "ask which campus first" rule), `fee_items.note`, `tenant_users.auth_user_id` (Supabase link), `tenants.fee_stale_after_days` (the tenant-set stale threshold from §8), `messages` unique `(tenant_id, channel_message_id)` (webhook replay protection).
- `access_requests` is intentionally **not** tenant-scoped (no tenant exists yet at sign-up).
- ⚠ `unanswered_questions.linked_faq_id` references `faqs(id)` without a tenant-composite key — harmless (RLS still hides foreign FAQs) but tighten in a later migration.
- Embeddings are `vector(768)` **provisionally**; adjust once the embedding model is chosen (free to change before data exists).
- **Verification status:** the SQL and the isolation test need a running Postgres to prove. See "Verification" in the hand-off message.

## Commands
```bash
pnpm install
pnpm validate:data     # seed data: shape, references, PRD §1.1 hard cases
pnpm db:up             # Postgres 16 + pgvector in Docker
pnpm db:migrate        # apply migrations (add -- --reset to start clean)
pnpm db:test           # RLS isolation test as the restricted app role
```
