# Native-speaker review — instructions

Thank you for reviewing these. There is no code involved — just a spreadsheet.

## What this is
`native-speaker-review.csv` has every Urdu and Roman Urdu question a test student might ask the university's
chatbot (52 of them). We need someone fluent in Urdu (and comfortable with the informal "Roman Urdu" people
actually text in) to check each one reads naturally and means what we intended.

## How to review
1. Open `native-speaker-review.csv` in Excel, Google Sheets, or Numbers.
2. Each row has one question, its script (`urdu`, `roman_urdu`), and which university it's for (`crescent-valley` or
   `nexora` — both are fictional demo universities, not real ones).
3. For each row, fill in:
   - **`ok(yes/no)`** — type `yes` if the question is natural and correct as written. Type `no` if it needs a fix.
   - **`fixed_text`** — only if you typed `no`: write the corrected version here.
   - **`notes`** — optional. Anything worth flagging (e.g. "nobody actually spells it this way", "sounds too
     formal for a chat message", "this Roman Urdu spelling is unusual — added the common one instead").
4. A few things worth specifically checking:
   - **Spelling variants matter.** Roman Urdu has no standard spelling (e.g. "fees" / "fiss", "scholarship" /
     "scolarship"). If a question uses a spelling nobody actually types, that's worth a `no` and a more natural
     alternative in `fixed_text`.
   - **Typos and short chat-style messages are intentional** in some rows (e.g. "fee kitni bscs ki") — these
     are meant to look like how someone actually texts, not textbook-correct sentences. Only flag them if they
     read as unnatural or don't make sense, not just because they're informal.
   - A few rows are adversarial test cases (asking the assistant to reveal secrets, override its rules, etc.) —
     these are supposed to sound like an attempted trick, so leave those as-is unless the Urdu itself is wrong.
5. Save the file (keep it as CSV) and send it back the same way you received it.

That's everything — no need to touch anything else in this project.
