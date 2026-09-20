# Phase 1 bake-offs: speech-to-text and embeddings

Both need real human input from you (recordings, native-speaker writing). Formats and a starter set are provided so collection can begin immediately.

## A. Roman Urdu / Urdu test messages (100+ needed)
File: `data/bakeoff/queries.jsonl` — one JSON object per line:
`{"id":"q001","script":"roman_urdu|urdu|english","text":"...","expects":{"kind":"faq|document|fact","ref":"<faq question or doc title or fact key>"},"notes":""}`

Rules (PRD §5): at least a third in Urdu script or Roman Urdu; include **spelling variants** of the same question (Roman Urdu has no standard spelling); include typos and short chat-style messages ("fee kitni bscs ki"). Native-speaker written or reviewed. ~20% marked `"heldout": true` and never used for tuning. A 20-item starter set (not a substitute for 100+) is already in the file for pipeline testing.

## B. Embedding bake-off
For each candidate model: embed every Crescent Valley FAQ + document chunk; embed each query; measure **recall@3 after the tenant filter** (the PRD's stated check), split by script. Pass bar suggested: ≥ 90% recall@3 on Roman Urdu variants of the same question. Record results in `docs/decisions.md`.

## C. Speech-to-text bake-off (30+ recordings)
Record with phones, in the actual formats: WhatsApp voice notes (OGG/Opus) and browser mic (WebM/MP4).
Mix: Urdu ≥ 12, English ≥ 8, Pakistani-accented English, noisy/echo/traffic ≥ 6, ≥ 3 in each browser the web mic supports.
Each recording must say things a student says: program names (BSCS, "BS Data Science"), campuses ("Lahore", "Islamabad"), numbers ("one hundred eighty-five thousand", "85 percent"), deadlines.
File: `data/bakeoff/voice/manifest.jsonl`: `{"file":"v001.ogg","language":"ur","reference":"<exact human transcript>","must_recognise":["BSCS","Islamabad"],"noise":"none|traffic|room","source":"whatsapp|web-chrome|web-safari"}`

Score per provider: WER on Urdu and English; **must_recognise hit rate** (decision driver); behaviour on 2-second silence; confidence-score availability; p50/p95 latency; cost per audio minute. Keep the audio out of git (`data/bakeoff/voice/*.ogg|webm|m4a` are ignored) — voice notes are personal data; delete after the bake-off.

## Note on the free Gemini tier
Free tier is for synthetic data only (PRD). Everything above uses synthetic/staged content, so it is allowed for the bake-off; anything with real student data waits for the paid tier.
