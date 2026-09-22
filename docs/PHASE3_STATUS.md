# Phase 3 — AI Agent, Guardrails & Evaluation: status

Exit condition (PRD §14): *Eval suite passes its release gates: 100% exact structured facts, correct refusals when
data is missing, zero leaks, and reply language matches the input.*

**In progress, blocked on billing** — see "What's blocking a real answer" below. Everything that doesn't need a paid
Gemini tier is done.

| PRD deliverable | Status | Where |
|---|---|---|
| Four tools: `search_knowledge`, `lookup_facts` (computed fields), `capture_lead`, `request_human` | ✅ | `apps/api/src/agent/tools.ts`, `facts.ts`. All tenant-scoped; `lookup_facts` computes `days_remaining`, `deadline_passed`, `computed_total` in code — the model never does arithmetic |
| Guarded system prompt | ✅ | `apps/api/src/agent/prompt.ts` |
| Code-side verifier, verify-then-reveal | ✅ | `apps/api/src/agent/verifier.ts` — every amount/date/percent in a reply must come from this turn's `lookup_facts`, a retrieved chunk (percent only), or the student's own words. Handles Urdu digits, lakh/hazar/k, spoken numbers in English/Roman Urdu/Urdu |
| `POST /api/chat` on a shared conversation core | ✅ (web only so far) | `apps/api/src/routes/chat.ts` → `agent/conversation.ts`. WhatsApp will call the same `handleMessage()` in Phase 6A |
| PII masking + message metadata | ✅ | `agent/pii.ts` (CNIC, card, phone, email); every message stores `tool_calls`, `verifier` outcome, `model`, token counts |
| 100+ question eval set | ✅ | `apps/api/eval/build-dataset.ts` → 104 Crescent Valley cases + 8 Nexora cases, expected values computed from `/data`, not typed by hand |
| Native-speaker review, held-out slice | 🟡 tooling done, review itself pending | See "Native-speaker review" below |
| Smoke set on every PR | ✅ (wired, unproven) | `.github/workflows/ci.yml` `eval-smoke` job. Skips with a warning until `GEMINI_API_KEY` is added as a GitHub secret |
| Language Rules (reply language/script, Urdu numeral normalization) | ✅ | `agent/language.ts`, verifier's `normaliseDigits` |
| Gemini-tier bake-off, models recorded | 🔴 blocked on billing | See below |
| Release gates pass | 🟡 not proven on the current code | The only full run (104 cases) predates several fixes; see "What the eval has already caught" |

## What's blocking a real answer
Your Google AI Studio project is on the free tier: 500 requests/day/model, and Pro-class models are blocked
entirely. The PRD requires a Flash-vs-Pro bake-off and, for any real tenant data, the paid tier anyway (free tier is
synthetic-data only). Two full eval runs (104 cases × ~3 requests each) exhausted the daily quota outright.
**Enable billing with a budget cap when ready**, then:
```bash
pnpm --filter @uaa/api eval -- --tenant crescent-valley --set full --model <candidate>
```
for each candidate model, and record the winner in `docs/decisions.md` next to the embedding choice.

## What the eval has already caught (fixed, regression-tested)
Found on the one full run that did complete, against `gemini-3.1-flash-lite`:
- **Dates were off by one day** in every timezone east of UTC — the pg driver's default date parser round-tripped
  through a JS `Date` and `toISOString()`. Fixed in `db.ts` (dates now come back as plain strings); regression test
  in `test/facts.test.ts` checks four timezones.
- **The verifier read "hours." as the "Rs." currency marker** ("15 to 18 credit hours" → flagged as an amount),
  causing a false reject. Fixed the word-boundary in `verifier.ts`; covered in `test/agent-units.test.ts`.
- **An Urdu reply that kept English program names/terms** (normal per the prompt's own instruction) was classified
  as English by the language detector. Fixed with word-level Urdu-script ratio in `language.ts`.
- Timeouts now retry once instead of failing the turn outright (`llm.ts`).

None of this needed a second full run to fix — each was reproduced with a single `eval/try.ts` call and fixed
against the local test suite (96 tests, no API calls, using a scripted fake model in `test/conversation.test.ts`).
**A fresh full run is still needed** once billing is on, to get real, current gate numbers — the 104-case numbers in
git history are from before these fixes and should not be quoted as current.

## Native-speaker review
`apps/api/eval/export-for-review.ts` → `pnpm --filter @uaa/api eval:review` writes every Urdu/Roman Urdu eval
question (52 of 112, English cases don't need this) to `eval/review/native-speaker-review.csv` — plain CSV, opens in
Excel/Sheets, no code needed. Reviewer fills in `ok` (yes/no) and, for `no`, `fixed_text`.
`pnpm --filter @uaa/api eval:apply-review` re-imports it into the dataset files and marks each case
`native_reviewed`. Regenerating the dataset (`eval:build`, e.g. after adding cases) preserves any already-reviewed
case by id instead of overwriting it, and warns if a reviewed id no longer exists.
**Not yet sent for review** — this is the same native-speaker dependency as the Phase 1 bake-off queries
(`data/bakeoff/queries.jsonl`); worth doing both in one sitting with the same person.

## Commands
```bash
pnpm --filter @uaa/api eval:build              # regenerate eval/datasets/*.jsonl from /data (safe to re-run)
pnpm --filter @uaa/api eval:review             # export Urdu/Roman Urdu questions to CSV
pnpm --filter @uaa/api eval:apply-review       # re-import the filled-in CSV
pnpm --filter @uaa/api eval -- --tenant crescent-valley --set smoke   # ~19 cases, cheap
pnpm --filter @uaa/api eval -- --tenant crescent-valley --set full    # 104 cases, needs paid tier headroom
pnpm test                                       # 96 tests, no API calls (fake-model conversation tests + units)
```

## Things to know
- **`lookup_facts` never guesses.** Draft rows are invisible to it (only `status = 'approved'`); a program with no
  fee data returns `no_data`, not a fallback figure. Covered directly in `test/facts.test.ts`, independent of any
  model behaviour.
- **Campus/student-type grounding**: the model can propose a campus or student type as a `lookup_facts` argument,
  but `tools.ts` drops it unless the student actually said it in this conversation (`groundedCampus`,
  `groundedStudentType`) — otherwise a model could quietly assume "Lahore" and skip the PRD's required clarifying
  question. Tested with abbreviations and Urdu-script city names.
- **Leak detection** is a second, independent layer from the verifier: a per-run canary string in the system prompt
  plus pattern checks (tool names, tenant ids, `pgvector`/`row-level security` internals) — if either fires, the
  reply is discarded exactly like a verifier failure.
- **Not in Phase 3 by design:** WhatsApp wiring (6A), rate limits/Turnstile/monthly caps (4), the web mic (6B).
