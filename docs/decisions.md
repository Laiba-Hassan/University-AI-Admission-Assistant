# Decision register — Phase 1 recommendations

Status values follow PRD §10: Locked · Recommended default · Open. Items below are what Phase 1 must close. **Nothing here is locked until you confirm it.**

## 2. WhatsApp access route — DECIDED for this project: **Meta Cloud API with Meta's free test number**
Context: this is a university project with no registered business entity, so Meta business verification (needs a legal entity + matching documents) is not possible, and neither is a production WhatsApp number.
- Everything the PRD requires for V1.3 (signed webhooks, tenant routing by `phone_number_id`, text + voice notes, staff reply, replay protection) is fully buildable and demonstrable with the **Meta test number** and up to 5 allow-listed recipient phone numbers (your own phone, supervisor, examiners).
- Crescent Valley and Nexora need two separate `phone_number_id`s to show routing. Meta allows a test number per app/WABA; create **two developer apps** (or two test WABAs) so each tenant has its own number. If Meta limits you to one, fall back to a second test number on a second Meta developer app.
- The code path is identical to production; going live later only means: register a business, complete verification, attach a real number. No re-architecture.
- BSPs also require business verification, so they are not an alternative here.
- Demo limitation to state in your report: messages only reach allow-listed numbers; free-form replies work inside the 24-hour window after the user messages first.

## 7. Speech-to-text — Open → decide by bake-off (candidates)
Whisper-family (e.g. `whisper-large-v3` hosted) · Google Cloud Speech-to-Text (`ur-PK`, `en-*`) · Gemini audio input. Score on the 30+ voice notes (see `bakeoff-plan.md`): word error rate on Urdu, **program/campus/fee-number recognition rate**, noisy-audio behaviour, confidence-score availability (PRD low-confidence rule), latency, cost per minute. Pick by the program-name recognition rate first — that is the failure the PRD says is hardest to catch.

## Embedding model — confirm in Phase 1
Candidates: Gemini `gemini-embedding-001` (output dimension selectable; 768 chosen provisionally in the schema), a multilingual open model (e.g. multilingual-e5-large, 1024-dim). Test: recall@3 on the 100+ Urdu/Roman Urdu queries against the Crescent Valley FAQ/document chunks, **after** the tenant filter. Roman Urdu spelling variants (e.g. "fees"/"fees"/"fiss", "scholarship"/"scolarship") must retrieve the same chunk. If the winner's dimension ≠ 768, edit `0001_schema.sql` before any data exists.

## Already locked in the PRD (no action)
Supabase Auth · Gemini (paid tier for real data; list Google as sub-processor) · approval-only sign-up · web voice input in V1.3 · n8n side-automations only · English-only dashboard · PWA then Windows desktop app.

## Recommended defaults to confirm
- Reply script after an Urdu voice note: **Roman Urdu** when the contact has never typed; tenant-overridable (seeded as `default_reply_script`).
- Desktop wrapper: Electron, Windows first — confirm target universities use Windows.
