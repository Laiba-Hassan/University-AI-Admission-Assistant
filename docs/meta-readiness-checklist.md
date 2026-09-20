# Meta / WhatsApp readiness checklist (PRD §6.2)

> **Project scope note:** no registered business entity, so the *Business verification* section below is **deferred (production only)**. Do the *Developer setup* section now: it gives you a free test number that is enough to build and demo Phase 6A/6B.

Meta business verification and app review take weeks and run in the background. Develop against Meta's **test number** until approved.

## Business verification — DEFERRED until a business entity exists (needed only for a real production number)
- [ ] A registered business entity (legal name exactly as on registration documents)
- [ ] 2–3 supporting documents whose **legal name, address and phone match the Meta Business Portfolio exactly** (registration certificate, utility bill / bank statement, tax registration)
- [ ] A public website showing the same legal business name (domain email preferred)
- [ ] Admin access to the Meta Business Portfolio (business.facebook.com)
- [ ] An international payment card (WhatsApp conversation charges)
- [ ] A dedicated phone number for WhatsApp Business that is **not** already registered in a personal/business WhatsApp app (needed later; the test number covers development)

## Developer setup
- [ ] developers.facebook.com app (type: Business) linked to the portfolio
- [ ] Add the WhatsApp product; note the test `phone_number_id`, WABA id, temporary token
- [ ] Configure webhook URL + verify token (Phase 2/6A); subscribe to `messages`
- [ ] Test-number setup: add up to 5 recipient phone numbers (yours, supervisor's) to the allow-list; create one test number per demo tenant (two apps if needed)
- [ ] Create a System User token (needs a Meta Business Portfolio, which a personal account can create without verification) (store in secrets manager, never in the DB — see `channel_connections.token_secret_ref`)
- [ ] (Deferred) Submit business verification
- [ ] (Deferred) Apply for Tech Provider status if you want Embedded Signup (decide route first — `decisions.md`)
- [ ] Message templates for after-hours / handoff follow-ups (24-hour customer-service window rules) — Phase 6A

## Do not
Do not use a personal WhatsApp number, copy another business's documents, or pair a demo university's name with a real institution's branding.
