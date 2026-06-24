# Outreach Review — His Real Sent Emails vs. the Playbook

Reviewed against [`docs/job-search-playbook.md`](../../docs/job-search-playbook.md) (Ben's 2019 paid consultation). Evidence base: **113 distinct
ESL cold-outreach threads** recovered from `chibuzor.ejimofor@gmail.com` SENT mail, 2019-06 → 2025-07
(8 non-ESL template clones — bartending, field-engineer, life-sciences — were excluded from the corpus).
See `corpus.md` for bodies and `index.csv` for the row-level data.

## Headline numbers

| Metric | Value |
|---|---|
| Distinct ESL outreach threads recovered | 113 |
| Date span | Jun 2019 – Jul 2025 (heaviest: 2019 n=52, 2020 n=20, 2022 n=18) |
| Got any reply | 23 / 113 (20%) |
| Interview-grade replies | 7 |
| Offer/contract-grade replies | 6 |
| Rejections (explicit) | 1 |
| Threads where he sent a follow-up | 15 / 113 |
| Distinct recipients | ~100 schools/recruiters |
| Primary market | Russia (75 of 113), then China (10), Saudi (5) |

His own claim of "tens to hundreds" sent, with offers, is corroborated: he ran a real, sustained
campaign and landed multiple interviews and at least several offers (Russia-heavy: Lexica, Smile English,
ILS, Orange Language Centre, P'titCREF, REWARD/Volgograd; plus Hangzhou/China, KILC Kazakhstan, ANY Warsaw,
Hungary CETP, OnTheMark Thailand).

## Principle-by-principle

### 1. "Every email must include ≥1 open-ended question that requires a response" — **NOT followed**
This is Ben's single most emphasised outreach rule, and it is the biggest gap.

- Only **10 of 113** initial emails contain *any* question mark, and only **1** contains a genuine
  open-ended question. ~90% of his cold emails end on a **statement**, not a question.
- His standard closer is a soft CTA, not a question:
  - *"Let me know if you will be free to speak this week or next week about this role."* (38 emails)
  - *"Let me know if positions are still open and get in touch…"* (9)
  - *"Let me know when the best day/time to connect via phone or Zoom!"* (8)
  These are easy to ignore precisely because nothing *requires* a reply — exactly the failure mode Ben warned about.
- The reference email he sent (`Native English Teacher Available - Moscow.eml`) is itself in this pattern:
  it closes *"Let me know if you will be free to speak this week or next week"* — a near-miss, not the
  *"Is your school still seeking an English teacher for the fall term?"* style Ben prescribed.
- **Counter-intuitive data point:** the 10 question-bearing emails got **0 replies**, vs 23/111 without.
  This is not evidence the rule is wrong — the question-bearing ones were scattered low-quality one-offs
  (Japan, Kurdistan, Kuwait) to cold generic inboxes. The rule was never tested *at scale* on his good
  markets. The takeaway for our templates: bake the question into the high-volume Russia/China template,
  not just the long-shots.

### 2. "Follow up frequently" — **Partially followed, and it clearly worked**
- He followed up in only **15 of 113** threads — most cold emails were fire-and-forget.
- But where he did follow up the payoff was dramatic: **10/15 (67%) got a reply** vs **13/98 (13%)**
  with no follow-up. Follow-ups were also where most interviews/offers landed (Orange Language Centre,
  P'titCREF, China/Hangzhou, KILC all involved multiple sent messages in-thread).
- **This is the strongest lever in the whole dataset** and he under-used it 7× out of 8.

### 3. Send from `chibuzor.ejimofor@gmail.com` — **Followed.** All recovered outreach is from this account.

### 4. Resume "five things jump out" + attachments — **Mostly followed.**
- Almost every email states the headline credentials in sentence one: *"TEFL-Certified Professional
  Teacher with Bachelor's Degree, available immediately"* — native-speaker + degree + cert + availability
  surfaced fast, matching Ben's resume rule transplanted into the email body.
- He consistently attaches resume + degree + TEFL (+ passport/photo for visa markets). Good.
- Skype `cheez20` is in his signature on the 2019 batch (Ben recommended headhunters on Skype) — and Skype
  is exactly how several interviews were arranged. Later (2022+) templates drop Skype for Zoom/WhatsApp.

### 5. Comp/contract math (≥200 RMB, ≥2× lowball, true per-hour) — **Not visible at outreach stage** (expected;
this is a negotiation-phase rule). One good signal: in the REWARD/Volgograd thread he answered the school's
screening questions by keeping hours and rate explicitly *"negotiable based on the rest of the contract…
depends on if housing is provided and the overtime rate"* — i.e. he was thinking in total-package terms,
consistent with the playbook.

### 6. Where to look — **Partially aligned.** He references *Dave's ESL Cafe* as a listing source in several
2022 emails, despite Ben's "stay away from Dave's (training centres)" advice. His best outcomes were
direct-to-school emails in Russia, not board-sourced training centres — which actually *supports* Ben.

## What worked vs. what didn't

**Worked**
- Direct-to-school cold emails in a focused market (Russia) — most replies, interviews and offers came from
  here, where he concentrated volume.
- Following up in-thread — 67% reply rate when he did.
- Country-/school-specific subject lines (*"P'titCREF English Teacher Positions - Moscow"*,
  *"Hangzhou ESL Teaching - CNSZ01"*) read as targeted, not spray-and-pray.
- Leading with credentials + immediate availability + attachments in the first 2 sentences.

**Didn't work / wasted effort**
- One-off generic blasts to far-flung markets (Kurdistan, Kuwait, UAE, Taiwan, Japan, Hong Kong) — 1 email
  each, no follow-up, ~0 replies. Low volume + no follow-up + no question = dead.
- Statement-only closers ("Let me know if…") — the dominant pattern and the dominant non-response pattern.
- Several emails addressed to the wrong name or with copy/paste artifacts (e.g. body opens *"Hi Simon,"* /
  *"Chibuzor MONECIA RESANDT"* mojibake) — sloppy mail-merge hurts credibility.

## Recommendations for the templates we'll build

1. **Hard-code an open-ended question as the closer** (Ben's rule #1). Default:
   *"Is your school still seeking an English teacher for the upcoming term?"* — and make the template
   refuse to send without exactly one such question. This is the single most under-applied piece of his
   own paid advice.
2. **Make follow-up a first-class, scheduled step, not optional.** Auto-queue follow-up #1 at ~3–4 days and
   #2 at ~10 days on any thread with no inbound reply. The data says this roughly 5×'s the reply rate.
3. **Concentrate volume by market.** His Russia win-rate vastly outperformed scattered one-offs. Favour
   depth (many schools in 1–2 target countries, each followed up) over breadth (one email to 14 countries).
4. **Keep the strong opener, fix the merge.** Sentence 1 = native-speaker + degree + TEFL + available now +
   attachments. Add strict field validation so the recipient name/country/school never mismatch (the
   "Hi Simon" / mojibake failures must be impossible).
5. **Subject = `Native English Teacher Available - {location}`** — his own standard 2019 subject
   (the exact format of the example email Ben reviewed without objection); avoid bare "English
   Teacher". (Earlier draft of this rec said school+role+location — corrected 2026-06-05.)
6. **Channel field in signature** (Skype/Zoom/WhatsApp) — interviews were almost always booked over these;
   include a live handle and offer specific time windows in the follow-up.
7. **De-prioritise Dave's-sourced training-centre leads** per the playbook; route those through the
   per-hour-math check before they're worth an email.
