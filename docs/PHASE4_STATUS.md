# Phase 4 — Demo Website & Web Widget: status

Exit condition (PRD §14): *A visitor asks a question on the demo site and gets a grounded, verified answer that is
saved to the database, and the limits demonstrably stop excess usage.*

**Done.** Backend hardening, the embeddable widget, and the demo website are all built and verified end to end
against the real API and a real Gemini call: a visitor question on the live site gets a grounded, verified answer,
saved to the database. This closes the phase's exit condition.

| PRD deliverable | Status | Where |
|---|---|---|
| Demo university website (Home, Programs, Faculties, Admissions, Fees, Scholarships, Campuses, Contact) | ✅ | `apps/web/` |
| Embeddable widget: loader + iframe, verify-then-reveal, fact cards, chips, thumbs, mobile, accessibility, widget key + origin, Turnstile, loading/error states | ✅ | `apps/widget/` |
| Monthly limits, rate limits, token caps before public reachability | ✅ (built in the backend-hardening commit, this phase) | `apps/api/src/ratelimit.ts`, `agent/conversation.ts` |
| Lead capture, consent, conversation persistence confirmed live | ✅ | `capture_lead` tool (Phase 3) exercised through the real widget; session persists via `localStorage` in the host page |

## The widget (`apps/widget/`)
A small standalone Preact bundle (esbuild, no framework beyond Preact) plus a vanilla-JS loader script, per PRD
§10. Production build: loader 3.3 KB, widget 21 KB, minified.

- **`loader.ts`**: the one `<script data-widget-key data-api>` tag a university adds. Creates the launcher button
  and the iframe, and — this is the important part — **is the one making the actual API `fetch()` calls**, not the
  iframe.
- **Why**: the iframe is served from one shared origin regardless of which university embeds it. If it called the
  API directly, every request would carry that same origin, making the per-tenant origin allowlist meaningless. The
  loader runs unsandboxed in the host page, so its requests carry the host page's real origin — what the widget key
  is actually allow-listed against. The iframe and loader talk over `postMessage` (`protocol.ts`); the widget never
  calls `fetch()` itself (`rpc.ts`).
- **`widget.tsx`**: the chat UI — branding, consent line, suggested-question chips (bootstrapped from approved
  FAQs), verify-then-reveal (a word-by-word reveal of a reply that is *already* fully verified server-side before
  it ever reaches the widget), fact cards with "as of" dates, thumbs feedback, language chips (English/Roman
  Urdu/اردو) that override auto-detect, RTL per message bubble, an always-visible "Talk to admissions" button, an
  after-hours banner (`working-hours.ts`, timezone-aware via `Intl`), and loading/unavailable states.
- **Turnstile**: real Cloudflare Turnstile renders when the tenant config carries a site key; locally, with no site
  key configured, the widget still exercises the full protocol using the backend's own dev bypass (see Phase 4
  backend hardening commit) — nothing about the flow is faked or skipped in test code, only the actual CAPTCHA UI.

## Real bugs found while getting this working end to end (all fixed)
Manual browser testing against the real API and a real Gemini call caught three bugs that none of the unit-level
work would have caught on its own:
1. **A genuine handshake race.** The loader sent `init` on the iframe's `load` event, but Preact's `useEffect`
   (which registers the widget's own message listener) can run *after* `load` fires — `postMessage` does not queue
   for a listener that attaches late, so the message was simply gone. Fixed with a proper two-way handshake: the
   widget announces `ready` at module-load time (before any framework lifecycle runs), and the loader only sends
   `init` once `ready` arrives.
2. **Missing CORS.** The widget is inherently cross-origin from the API in any real deployment; without
   `Access-Control-Allow-Origin` the browser blocks the response before the app's own origin-allowlist check ever
   runs. Added `apps/api/src/cors.ts`, mounted on the widget and chat routers. The *authorization* decision still
   belongs entirely to `resolveWidgetTenant`'s key+origin check — CORS only controls whether the browser lets the
   widget's JS read the response.
3. **The challenge pass was obtained but never sent.** The RPC relay protocol had no field for extra headers, so
   `x-challenge-pass` — issued correctly, stored correctly in state — never actually reached the server. Every new
   conversation attempt failed with `403 challenge_required`. Fixed by extending the fetch-relay message to carry
   headers end to end (`protocol.ts` → `rpc.ts` → `loader.ts` → `widget.tsx`).

None of these were visible from the terminal or from typecheck; they only showed up once the whole thing ran in a
real browser against a real iframe boundary. Verified afterward: a real message ("BSCS ki fees kitni hai Lahore
campus mein local student ke liye?") through the actual widget UI got the correct fee (PKR 185,000), correct
language (Roman Urdu), `verifier.ok: true`, and a fact card, confirmed by reading it back from the database.

## The demo website (`apps/web/`)
Next.js (App Router) + Tailwind, per PRD §10, statically generated — all 8 pages prerender at build time (103–106 KB
first-load JS each). Not using shadcn/ui: the PRD names it as an example ("a ready-made component kit, e.g.
shadcn/ui"), and for 8 mostly-static content pages a small set of hand-written Tailwind components is simpler and
lighter than the Radix-based setup shadcn/ui brings in; worth revisiting once the dashboard (Phase 5) needs richer
interactive components.

- **Content source**: every page reads straight from `/data/<tenant>/*.json` and `documents/*.md` at build time —
  the exact same files `apps/api/src/seed/seed.ts` loads into Postgres, so the static pages (programs, fees,
  intakes, eligibility, scholarships, campuses) can never drift from what the chat widget answers from. `src/lib/content.ts`
  is the one place that reads this; markdown documents render via `marked`, filtered to `approved: true`.
  Which tenant a build serves is `NEXT_PUBLIC_TENANT` (defaults to `crescent-valley`) — one real deployment
  is one university's own site, matching how the PRD scopes this (one flagship demo site, not a tenant switcher).
- **Widget embed**: `src/components/WidgetEmbed.tsx` adds the loader `<script>` tag site-wide (root layout),
  exactly as a real university would embed it, pointed at the tenant's dev widget key by default.
- **Pages**: Home (stats, upcoming intake, about, faculties); Programs (grouped by faculty, links to fees/requirements);
  Faculties; Admissions (process doc, intake table with a live "closed" flag on passed deadlines, eligibility +
  documents per program, all 30 FAQs as an accordion); Fee Structure (grouped tables per program plus general fees,
  flags programs with no published fee, refund policy doc); Scholarships; Campuses (programs offered per campus);
  Contact (office hours from `tenant.working_hours`, campus list, visiting info).
- **Verified live**: read back via `get_page_text`/screenshots against the real seeded data — the intake table
  correctly marks the passed Fall 2026 deadline "(closed)", the fee table correctly shows BSCE's stale
  `last_verified_at` (Nov 2, 2025) and flags BSDS as "Not yet published" — the same two Phase 1 hard cases the eval
  set and the agent are built to handle. Checked at mobile width too (nav wraps, cards go single-column).
- **A real bug found and fixed**: the About (Home) and fee-refund-policy (Fees) sections originally had their own
  hardcoded heading *and* rendered the markdown document, whose own front-matter title is already an `<h1>` — a
  visible duplicate heading on both pages. Fixed by dropping the redundant wrapper heading and letting each
  document's own title stand alone.

## Test coverage and its limits
`apps/widget/test/` covers the one pure, DOM-independent piece (`working-hours.ts`). The protocol/handshake logic
(`loader.ts`, `rpc.ts`, `widget.tsx`) has **no automated test** — it runs across a real iframe boundary with real
`postMessage` and DOM APIs, which `node:test` cannot exercise without a browser. The manual browser session above is
the only verification it has had. **Worth adding before this ships**: a Playwright (or similar) test that drives
the actual embedded widget in a real browser and would have caught all three bugs above automatically. Flagging
this honestly rather than claiming coverage that doesn't exist.

## Commands
```bash
pnpm --filter @uaa/widget build   # loader.js + widget.js + widget.html + styles.css -> apps/widget/dist/
pnpm widget:dev                   # watch + serve dist/ on :5174
pnpm widget:build                 # one-off build (add NODE_ENV=production to minify)
pnpm --filter @uaa/widget test    # working-hours.ts unit tests
pnpm web:dev                      # demo site on :3000
pnpm web:build                    # production build (statically generates all 8 pages)
```
To see the whole thing working together locally: `pnpm db:up && pnpm db:migrate && pnpm seed`, then in three
terminals `pnpm api:dev`, `pnpm widget:dev`, `pnpm web:dev`, then open http://localhost:3000. (Or see
`apps/widget/test-embed.html` for a minimal host page without the full site.)

## Things to know
- **`apps/widget/dist/` and `apps/web/.next/` are gitignored** — build output, generated on demand, same as `.cache/`.
- No CDN/versioning yet for the widget (PRD: "served from a CDN and versioned, so updates never break a live
  university site") — fine for a demo running on localhost; matters once this is actually deployed for a real tenant.
- Accessibility: keyboard-reachable controls, visible focus rings, `aria-label`s on icon-only buttons, semantic
  headings throughout the site. Not yet checked against a screen reader or a full WCAG 2.1 AA audit — open.
- Mic button: correctly absent. Phase 6B.
- The demo site has no automated tests of its own (it's static content rendering, verified manually in-browser
  against the real seeded data, as described above). Same honest gap as the widget: a Playwright smoke test that
  loads each page and checks for known content would be cheap to add and worth doing before this ships for real.
