# Staging deployment — Railway + Vercel

Gets you real `https://` links for testers. Three pieces: Supabase (database, already documented in
`docs/staging-setup.md`), Railway (API), Vercel (dashboard, web, widget — all static/Next.js).

Railway over Render: Render's free web service tier now asks for a card up front even though it doesn't charge
you on it; Railway's trial gives $5/month of usage without one. `render.yaml` is still in the repo if you'd
rather use Render later (e.g. once on a paid plan) — the env var list below is identical either way.

Account creation and clicking through each host's dashboard has to happen on your side (I can't sign up for
services or enter payment/billing details on your behalf) — this doc is the exact sequence to follow.

## 1. Supabase (database)

Follow `docs/staging-setup.md` end to end first — project, roles, connection strings, migrations. Keep the four
`DATABASE_URL*` values and your `SUPABASE_JWKS_URL` handy, you'll paste them into Railway in step 2.

## 2. Railway (API)

1. Push this repo to GitHub if it isn't already (it is — `Laiba-Hassan/University-AI-Admission-Assistant`).
2. Railway dashboard → **New Project** → **Deploy from GitHub repo** → pick `University-AI-Admission-Assistant`.
3. Railway reads `railway.json` at the repo root automatically for the build/start commands — you shouldn't need
   to touch Settings → Build, but if it doesn't pick it up, set manually:
   - Build command: `corepack enable && pnpm install --frozen-lockfile`
   - Start command: `pnpm --filter @uaa/api start`
4. Settings → **Networking** → **Generate Domain** to get a public URL (Railway doesn't expose one by default).
   You'll get something like `https://enrollium-api-production.up.railway.app` — that's your `API_URL` for the
   Vercel step.
5. Settings → **Variables** → add every one of these (Railway has no concept of "required", it just won't boot
   correctly without them — `apps/api/src/config.ts` is the source of truth if you want to double check one):

   Do **not** add `NODE_ENV` yourself — `railway.json`'s `startCommand` already sets it to `production` inline,
   scoped to runtime only. Adding it as a Variable applies it to the *build* phase too, which makes `pnpm
   install` skip devDependencies (confirmed the hard way: `tsx: not found`, since this API runs TypeScript
   directly via `tsx` rather than a compiled build step).

   - The four Supabase connection strings + `SUPABASE_JWKS_URL` from step 1
   - `GEMINI_API_KEY` (your existing key)
   - `SECRETS_ENCRYPTION_KEY` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `CHALLENGE_SIGNING_SECRET` — any random string, 16+ chars
   - `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` — your Stripe **test mode** keys
   - `STRIPE_WEBHOOK_SECRET` — fill in *after* step 2.5 below
   - `WHATSAPP_*`, `VAPID_*`, `TURNSTILE_*` — only if you're testing those features; leave blank otherwise, each one no-ops safely when unset (see the comments in `apps/api/src/config.ts`)
   - `RESEND_API_KEY` / `SMTP_FROM` — only if you want staff invites actually emailed instead of shown as a copyable link. Sign up at resend.com (free tier), create an API key. Don't use raw SMTP here -- Railway (and most PaaS hosts) blocks outbound SMTP ports entirely as anti-spam policy, confirmed the hard way: every send hung for the full connection timeout regardless of credentials.

   Railway auto-sets `PORT` itself (the API already reads `process.env.PORT`, `apps/api/src/config.ts:10`) — don't
   set it yourself.
6. Save variables → it redeploys automatically.

   Unlike Render's free tier, Railway's trial doesn't spin the service down when idle, so there's no cold-start
   delay for testers.

### 2.5 Stripe webhook
Stripe Dashboard → Developers → Webhooks → **Add endpoint** → `https://<your-railway-domain>/webhooks/stripe`,
event `invoice.payment_succeeded` and `invoice.payment_failed`. Copy the signing secret it gives you back into
Railway's `STRIPE_WEBHOOK_SECRET` variable — it redeploys automatically when you save it.

## 3. Vercel (dashboard, web, widget)

This is a pnpm monorepo, so each app is its own Vercel **project** pointed at a different subfolder of the same
repo — not three separate repos.

For each of `apps/dashboard`, `apps/web`, `apps/widget`:
1. Vercel dashboard → **Add New → Project** → import the same GitHub repo (you'll do this three times, once per app).
2. **Root Directory**: set to `apps/dashboard` (or `apps/web`, `apps/widget`).
3. Framework preset:
   - `apps/dashboard` and `apps/web` → Next.js (auto-detected)
   - `apps/widget` → **Other**. Build command: `node build.mjs`. Output directory: `dist`.
4. Install command: leave Vercel's default (`pnpm install`) — it runs from the repo root automatically once Root
   Directory is set, so the workspace's shared packages still resolve.
5. Environment variables (Project Settings → Environment Variables):

   | App | Variable | Value |
   |---|---|---|
   | dashboard | `NEXT_PUBLIC_API_URL` | your Railway domain from step 2.4, e.g. `https://enrollium-api-production.up.railway.app` |
   | dashboard | `NEXT_PUBLIC_WIDGET_URL` | the widget project's Vercel URL (step 6 below) |
   | web | `NEXT_PUBLIC_API_URL` | same Railway URL |
   | web | `NEXT_PUBLIC_WIDGET_URL` | the widget project's Vercel URL |
   | web | `NEXT_PUBLIC_WIDGET_KEY` | the real tenant's widget key (Settings → Channels in the dashboard, once a tenant exists) |
   | widget | *(none needed)* | the embedding page supplies the API origin via the `data-api` attribute, not a build-time var |

6. Deploy `apps/widget` first so you have its URL for the other two projects' `NEXT_PUBLIC_WIDGET_URL`.

You'll end up with three URLs, e.g.:
- `https://enrollium-dashboard.vercel.app`
- `https://enrollium-web.vercel.app`
- `https://enrollium-widget.vercel.app`

Send testers the dashboard URL for staff, and the web URL to see the widget live on a page.

## Do future changes apply automatically?

Yes, once each project is connected via GitHub (which both "Deploy from GitHub repo" on Railway and "Add New →
Project" on Vercel do by default): every `git push` to `main` triggers a new deploy automatically on both —
no redeploy step needed. Railway shows build logs under the service's Deployments tab; Vercel shows them under
the project's own Deployments tab. A push that breaks the build just fails that one deployment and keeps serving
the last good one, so testers never see a broken build.

(A push to a different branch or a PR gets its own **preview** URL on Vercel instead of touching production —
useful if you want to test a change before it reaches testers, but not required.)

## Mobile

The dashboard is already a installable PWA (`apps/dashboard/public/manifest.json` + `service-worker.js` +
`InstallPrompt.jsx`) — on a phone, visiting the Vercel URL in Chrome/Safari offers "Add to Home Screen", which
installs it as a standalone app icon with no browser chrome. That part works today, same as desktop.

What's *not* specifically tuned is the small-screen layout itself — nothing in the codebase currently has
mobile-specific breakpoints, so panels like the icon sidebar and multi-column grids haven't been checked on a
narrow viewport. Tailwind's responsive defaults mean it won't be broken, but it hasn't been verified or polished
for a phone screen either. Worth a separate pass if staff are actually expected to use it on mobile day-to-day,
rather than just install it and mostly use desktop.
