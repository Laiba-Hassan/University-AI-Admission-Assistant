# Staging on Supabase — setup

Local development and CI use Docker; staging uses Supabase Postgres + Supabase Auth (decision locked in `decisions.md`).
**Not yet tested against a real Supabase project** — expect to adjust the items marked ⚠ the first time.

## 1. Create the project
Supabase Dashboard → New project. Save the database password for the built-in `postgres` role.

## 2. Create the roles (once)
Open `infra/supabase-roles.sql`, replace the three `CHANGE_ME_*` passwords, and run it in **SQL Editor**.
Docker creates roles from `infra/init-roles.sql` automatically; Supabase does not, so this step is manual. Your passwords will differ from the local ones, and that is expected — they only live in the staging environment's variables.

## 3. Connection strings
Dashboard → Connect. Use the **direct** connection (port 5432) or the **session pooler** for migrations and the queue, and the **transaction pooler** (port 6543) is fine for the API (the tenant setting is per transaction, so pooling cannot mix tenants). ⚠ On the poolers the username is `role.<project-ref>` (e.g. `app_user.abcdefgh`), copy the exact string shown.

| Variable | Role | Connection |
|---|---|---|
| `DATABASE_URL` | `app_user` | transaction pooler or direct |
| `DATABASE_URL_MIGRATOR` | `app_migrator` | direct / session |
| `DATABASE_URL_QUEUE` | `app_queue` | **direct / session** (pg-boss needs session features) |
| `DATABASE_URL_ADMIN` | `postgres` | direct; used only by `pnpm db:migrate` |

⚠ TLS: Supabase requires SSL. If Node reports a certificate error, append `?sslmode=no-verify` to the URLs (or supply Supabase's CA certificate).

## 4. Migrate
With the four variables set in your shell (or a private `.env.staging`, never committed):
```bash
pnpm db:migrate        # applies pending migrations, recorded in schema_migrations
pnpm db:test           # RLS isolation test as app_user
```
`--reset` is refused for non-local hosts on purpose.

## 5. Seed (optional, demo data only)
`pnpm seed` writes the two demo tenants (dev widget keys, placeholder WhatsApp ids) using `DATABASE_URL_MIGRATOR` and `GEMINI_API_KEY`. Do not seed a database that holds real tenants: it deletes and recreates the demo tenants only, but the widget keys are public dev values.

## 6. Auth (Phase 5 does the login flow; the API only verifies tokens now)
Set **one** of: `SUPABASE_JWKS_URL` (⚠ newer projects sign with asymmetric keys; the JWKS URL is under Auth → JWT Keys/Settings in the dashboard, typically `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`) or `SUPABASE_JWT_SECRET` (legacy shared-secret projects).

## Notes
- Databases created before migration tracking must be rebuilt: `pnpm db:migrate -- --reset` (local only).
- `app_queue` is also defined in `infra/init-roles.sql` (Docker). Keep the two role files in sync.
