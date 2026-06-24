# Job-Search Playbook (ESL / Teach-Abroad)

Distilled, durable advice that informs how jobkit builds resumes, picks boards, and writes outreach. The core of this is from a **2019 paid consultation with Ben (Ben Teaches English Overseas, `ben@benteachesenglishoverseas.com`)** — direct, no-sugarcoat ESL career coaching the user paid for. Source: Gmail threads in `chibuzor.ejimofor@gmail.com` (Jun–Aug 2019, "New Client Questionnaire + Contract review" and "Job Search Update + Feedback requested"). His site/domain is now defunct, so this is the surviving record. *(His framing, condensed; not legal/financial advice.)*

## Resume (for ESL applications abroad)

Recruiters skim in ~8 seconds, so **five things must jump out immediately**, before any scrolling:

1. Native-level speaker
2. Degree(s)
3. Certificate(s) (TEFL/TESOL/CELTA)
4. Skype / contact
5. Availability

Concrete rules:

- Lead with a **bold summary line** between contact details and education that shows what you offer (not what you want). Example he wrote for this profile: *"TEFL-Certified Professional Educator with Bachelor's Degree and American Passport — Available Immediately."*
- Signal you're an American native speaker: put **`USA`** after the state (people don't know US cities/states), put **`+1`** before the phone number, consider a mailing address.
- **Drop the GPA and graduation dates** — don't highlight being a recent grad (don't deny it, just don't draw the eye to it).
- **Cut short-duration jobs (3–6 months) and intern/tutoring roles.** These are ESL red flags: short stints read as *flight risk* (employers won't fund a visa for someone who may leave); intern/tutoring reads as padding/unverifiable. Exception: keep safety/training experience if applying to a Safety-English program (e.g. Saudi Aramco).
- Frequent location changes also raise flags — be deliberate about what you show.
- Keep formatting consistent (e.g. don't add punctuation to bullets in only one section).

## Compensation & contract math

- **Never work for less than ~200 RMB / $30 USD per hour in China.** It isn't necessary.
- **Calculate true per-hour pay from the *entire* contract**, then compare apples-to-apples. Sticker salary is misleading: 16k RMB for 25 contact hours with no office hours is far better than 16k for a 50-hour on-site week. Unused on-site hours are income you can't earn elsewhere.
- **Training centers**: highest sticker price, **lowest real per-hour** (they keep you on site). Best-value roles: **public & private K-12, universities and colleges.**
- Aim for **≥2× a lowball offer** before accepting. (He told the user to "run away from" a 16k English-First-style contract.)
- Strategy to hit financial goals fast: China + a low-hours/decent-pay base contract, then stack extra high-hourly private classes/clientele on top → goals in ~1–2 years.

## Where to look

- **seriousteachers.com** — recommended (jobkit adapter: `seriousteachers`).
- Expat-specific job sections, e.g. **shenzhenparty.com** for Shenzhen.
- **Headhunters on Skype** — tell them exactly what you want.
- "Angelina's ESL Cafe."
- **"Stay away from Dave's"** — ESL Cafe lists almost exclusively training centers. (jobkit keeps the modern eslcafe board adapter for coverage, but treat its training-center listings with this skepticism — and per-hour-math them.)

## Outreach email (the core tactic)

- **Emails without a question are easy to ignore.** Always include **at least one open-ended question that requires a response** — e.g. *"Is your school still currently seeking an English teacher for the fall term?"* A reply confirms the address is live, the message landed, and your documents were received; it also gives you a thread to follow up on.
- **Follow up frequently.**
- Send from **`chibuzor.ejimofor@gmail.com`** (the account used for this whole job search).

### Validated against the user's own 113 sent emails (2019–2025)

A mining of the actual sent outreach (see [`job-data/outreach-sent/review.md`](job-data/outreach-sent/review.md)) shows how little of Ben's advice was applied — and proves it works where it was:

- **Open-ended question: applied in ~1 of 113 emails.** The dominant closer was a statement ("Let me know if you'll be free to speak…") — exactly the ignorable pattern Ben warned against. *This is the single most under-applied piece of paid advice; the `outreach` module now enforces it.*
- **Follow-up was the biggest lever and under-used.** Followed up in only 15/113 threads, but those got a **67% reply rate vs 13%** without — roughly **5×**. → make follow-up a scheduled, first-class step.
- **Concentrate by market.** Russia (75 emails, where volume was concentrated) drove most of the 6 offers / 7 interviews; scattered one-offs to far-flung countries with no follow-up got ~0 replies.
- **Subject line: `Native English Teacher Available - {location}`** — the user's own proven 2019 format (the exact subject of the example email Ben reviewed: *"Native English Teacher Available - Moscow"*; Ben changed nothing about it). Not bare "English Teacher"; no school name.
- **Fix the merge:** several sends had wrong names / mojibake ("Hi Simon," …) — validate fields so a recipient/school/country mismatch is impossible.

> See [job-boards.md](job-boards.md) for the scrapable boards and the pipeline that pulls them.
> An outreach/email module (compose + send from the Chibuzor account, applying the question +
> follow-up rule above) is the planned next piece.
