# Outreach Review — His Real Sent Emails vs. the Playbook

Reviewed against [`docs/job-search-playbook.md`](../../docs/job-search-playbook.md) (Ben's 2019 paid consultation). Evidence base: **113 distinct ESL cold-outreach threads** recovered from `chibuzor.ejimofor@gmail.com` SENT mail, 2019-06 → 2025-07 (8 non-ESL template clones — bartending, field-engineer, life-sciences — were excluded from the corpus). See `corpus.md` for bodies and `index.csv` for the row-level data.

## Headline numbers

| Metric                                  | Value                                                           |
| --------------------------------------- | --------------------------------------------------------------- |
| Distinct ESL outreach threads recovered | 113                                                             |
| Date span                               | Jun 2019 – Jul 2025 (heaviest: 2019 n=52, 2020 n=20, 2022 n=18) |
| Got any reply                           | 23 / 113 (20%)                                                  |
| Interview-grade replies                 | 7                                                               |
| Offer/contract-grade replies            | 6                                                               |
| Rejections (explicit)                   | 1                                                               |
| Threads where he sent a follow-up       | 15 / 113                                                        |
| Distinct recipients                     | ~100 schools/recruiters                                         |
| Primary market                          | Russia (75 of 113), then China (10), Saudi (5)                  |

His own claim of "tens to hundreds" sent, with offers, is corroborated: he ran a real, sustained campaign and landed multiple interviews and at least several offers (Russia-heavy: Lexica, Smile English, ILS, Orange Language Centre, P'titCREF, REWARD/Volgograd; plus Hangzhou/China, KILC Kazakhstan, ANY Warsaw, Hungary CETP, OnTheMark Thailand).

## Principle-by-principle

### 1. "Include a question that requires a response" — **Rarely followed**

Ben called his example an "open ended question," although *"Is your school still seeking... ?"* is
grammatically a yes/no question. The durable idea is to give the recipient one natural,
reply-producing hiring-status question.

- Only **10 of 113** initial emails contain *any* question mark, and only **1** contains a genuine open-ended question. ~90% of his cold emails end on a **statement**, not a question.
- His standard closer is a soft CTA, not a question:
  - *"Let me know if you will be free to speak this week or next week about this role."* (38 emails)
  - *"Let me know if positions are still open and get in touch…"* (9)
  - *"Let me know when the best day/time to connect via phone or Zoom!"* (8) These are easy to ignore precisely because nothing *requires* a reply — exactly the failure mode Ben warned about.
- The reference email he sent (`Native English Teacher Available - Moscow.eml`) is itself in this pattern: it closes *"Let me know if you will be free to speak this week or next week"* — a near-miss, not the *"Is your school still seeking an English teacher for the fall term?"* style Ben prescribed.
- **Counter-intuitive data point:** the 10 question-bearing emails got **0 replies**, while the
  remaining 103 threads accounted for all 23 replies. This is not a clean test of the wording: the
  question-bearing messages were scattered one-offs to weak routes and markets. The corpus neither
  validates nor disproves Ben's advice.

### 2. "Follow up frequently" — **Partially followed and strongly associated with replies**

- He followed up in only **15 of 113** threads — most cold emails were fire-and-forget.
- **10/15 (67%)** followed-up threads got a reply versus **13/98 (13%)** without a sent follow-up.
  Follow-ups also appeared in several interview/offer threads. This is observational: recipient
  quality, prior interest, market, and thread context are confounders, so the audit does not prove a
  causal 5× effect.

### 3. Sending account — **Consistent in this corpus.** All recovered outreach is from

`chibuzor.ejimofor@gmail.com`; Ben did not establish that account as a general rule.

### 4. Resume "five things jump out" + attachments — **Mostly followed.**

- Almost every email states the headline credentials in sentence one: *"TEFL-Certified Professional Teacher with Bachelor's Degree, available immediately"* — native-speaker + degree + cert + availability surfaced fast, matching Ben's resume rule transplanted into the email body.
- He consistently attaches resume + degree + TEFL (+ passport/photo for visa markets). Good.
- Skype `cheez20` is in his signature on the 2019 batch (Ben recommended headhunters on Skype) — and Skype is exactly how several interviews were arranged. Later (2022+) templates drop Skype for Zoom/WhatsApp.

### 5. Comp/contract math (≥200 RMB, ≥2× lowball, true per-hour) — **Not visible at outreach stage**

This is a negotiation-phase rule, as expected. One good signal: in the REWARD/Volgograd thread he answered the school's screening questions by keeping hours and rate explicitly *"negotiable based on the rest of the contract… depends on if housing is provided and the overtime rate"* — i.e. he was thinking in total-package terms, consistent with the playbook.

### 6. Where to look — **Partially aligned**

He references *Dave's ESL Cafe* as a listing source in several 2022 emails, despite Ben's "stay away from Dave's (training centres)" advice. His best outcomes were direct-to-school emails in Russia, not board-sourced training centres — which actually *supports* Ben.

## What worked vs. what didn't

**Worked**

- Direct-to-school cold emails in a focused market (Russia) — most replies, interviews and offers came from here, where he concentrated volume.
- Following up in-thread — 67% reply rate when he did.
- Country-/school-specific subject lines (*"P'titCREF English Teacher Positions - Moscow"*, *"Hangzhou ESL Teaching - CNSZ01"*) read as targeted, not spray-and-pray.
- Leading with credentials + immediate availability + attachments in the first 2 sentences.

**Didn't work / wasted effort**

- One-off generic blasts to far-flung markets (Kurdistan, Kuwait, UAE, Taiwan, Japan, Hong Kong) — 1 email each, no follow-up, ~0 replies. Low volume + no follow-up + no question = dead.
- Statement-only closers ("Let me know if…") — the dominant pattern and the dominant non-response pattern.
- Several emails addressed to the wrong name or with copy/paste artifacts (e.g. body opens *"Hi Simon,"* / *"Chibuzor MONECIA RESANDT"* mojibake) — sloppy mail-merge hurts credibility.

## Recommendations for the templates we'll build

1. **Require one useful hiring-status question as the closer.** Default: *"Is your school still
   seeking an English teacher for the upcoming term?"* Do not call it open-ended or claim the corpus
   proves it improves response rate.
1. **Make follow-up a first-class, scheduled step.** The data strongly supports testing it. The
   exact intervals should be an explicit product policy; Ben's surviving correspondence does not
   specify 3-4 and 10 days.
1. **Concentrate volume by market.** His Russia win-rate vastly outperformed scattered one-offs. Favour depth (many schools in 1–2 target countries, each followed up) over breadth (one email to 14 countries).
1. **Keep the strong opener, fix the merge.** Sentence 1 = native-speaker + degree + TEFL + available now + attachments. Add strict field validation so the recipient name/country/school never mismatch (the "Hi Simon" / mojibake failures must be impossible).
1. **Treat `Native English Teacher Available - {location}` as a historical candidate pattern, not a
   validated universal subject.** Ben saw an example with that subject but did not explicitly
   endorse it. A listed job may benefit from a role- or school-specific subject.
1. **Channel field in signature** (Skype/Zoom/WhatsApp) — interviews were almost always booked over these; include a live handle and offer specific time windows in the follow-up.
1. **De-prioritise Dave's-sourced training-centre leads** per the playbook; route those through the per-hour-math check before they're worth an email.
