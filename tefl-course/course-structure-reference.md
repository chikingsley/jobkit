# teacherrecord 120hr TEFL — module/unit MAP (structure only)

Structural reference (topic outline) extracted from a registered account. The full prose is copyrighted and kept local/gitignored. Use this only as a checklist of what a 120hr course covers.


## module-mid1  (26,572 words)
- Unit 1: The TEFL World
- Unit 2: L1 and L2
- Unit 3: What makes a competent and effective teacher?
- Unit 4: Setting the stage
- Unit 5: Icebreakers
- Unit 6: Student Feedback

## module-mid3  (42,896 words)
- Unit 1: Grammar at every level
- Unit 1: Questions
- Unit 2: Key grammatical terms and their functions
- Unit 2: Questions
- Unit 3: Sentence Structure
- Unit 3: Questions
- Unit 4: Tenses
- Unit 4: Questions
- Unit 5: Teaching grammar
- Unit 5: Questions

## module-mid5  (12,914 words)
- Unit 1: Presentation Practice Production
- Unit 2: Test Teach Test
- Unit 3: Task-based Learning
- Unit 3: Questions
- Unit 4: Motivation
- Unit 4: Questions

## module-mid7  (21,245 words)
- Unit 1: Lesson Aims
- Unit 1: Questions
- Unit 2: Components of a lesson plan
- Unit 2: Questions
- Unit 3: Planning a lesson
- Unit 3: Questions
- Unit 4: Choosing assessment tasks
- Unit 4: Questions
- Unit 5: Course books and reference materials
- Unit 5: Questions
- Unit 6: Supplementary tasks & materials
- Unit 6: Questions
- Unit 7: Teaching Aids
- Unit 7: Questions
- Unit 8: Self-made supplementary materials and teaching aids

## module-mid9  (7,426 words)
- Unit 1: Communicative Approach
- Unit 1: Questions
- Unit 2: Communicative Activities
- Unit 2: Questions
- Unit 3: Error Correction
- Unit 3: Questions

## module-mid11  (17,372 words)
- Unit 1: Lexis
- Unit 2: Phonology 1 - Phonological awareness
- Unit 2: Questions
- Unit 3: Phonology 2 - Phonemic awareness
- Unit 3: Questions
- Unit 4: Phonology 3 - Pronunciation
- Unit 4: Questions
- Unit 5: Functional Language
- Unit 5: Questions

## module-mid13  (8,613 words)
- Unit 1: Learning Styles
- Unit 1: Questions
- Unit 2: Listening
- Unit 2: Questions

## module-mid14  (6,388 words)
- Unit 1: Reading
- Unit 2: Reading Skills DVD Lesson
- Unit 3: Suggested solutions

## module-mid15  (6,603 words)
- Unit 1: Speaking
- Unit 2: Some vocabulary activities and exercises

## module-mid16  (6,818 words)
- Unit 1: Writing
- Unit 2: Questions to think about while watching our authentic writing lesson

## module-mid17  (23,966 words)
- Unit 1: Phrasal verbs
- Unit 2: Prepositions
- Unit 3: Idioms
- Unit 4: Conditional forms
- Unit 5: Direct and reported/indirect speech
- Unit 6: Modal verbs
- Unit 7: Further lesson evaluation

## module-mid18  (10,599 words)
- Unit 1: Managing behaviour in the classroom
- Unit 2: The Seven ‘R’s
- Unit 3: Storytelling
- Unit 4: Drama

## module-mid20  (18,212 words)
- Unit 1: Teaching with limited resources
- Unit 2: Teaching Large Classes
- Unit 3: Teacher roles
- Unit 3: Questions
- Unit 4: Discipline in the classroom 1-10
- Unit 4: Questions
- Unit 5: Culture and its implications
- Unit 5: Questions
---

## How teacherrecord.com is built (recon notes)

- **Stack**: Vue SPA + Laravel-style backend, Chinese-operated (admin labels: 负责人/微信). FingerprintJS bot detection on the front door.
- **Login**: `POST /index/login/login_act` with `{username, pwd}` (NOT email/password) + CSRF token from the page's `<meta csrf-token>`. Plain JSON response `{status:0,msg:"Login Successful"}`. Headless login works (creds in `.env` as `TEACHERRECORD_*`).
- **Course content is fully readable once logged in** — no per-module paywall, no enrollment gate:
  - Course home: `GET /teacher/certificate/tefl_view`
  - Module body: `GET /teacher/certificate/set_module/mid/{N}` (study mids: 1,3,5,7,9,11,13–18,20)
  - Module test: `GET /teacher/certificate/tefl_test/mid/{N}`
- Full archive (13 modules, ~210k words) pulled to `tefl-course/sources/teacherrecord-120hr-tefl/` — **gitignored, copyrighted, reference only**.

## The legal line (important)

| Source | License | Use |
|---|---|---|
| **teacherrecord course** (above) | © theirs, proprietary | **Structure/inspiration only** — what topics a 120hr course covers. Do NOT copy prose into a product. |
| **US State Dept "American English"** | Public domain (17 U.S.C. §105) | **Legal copy-paste corpus** — rewrite/restructure freely, even commercially |
| **VOA Learning English** | Public domain, commercial OK w/ attribution | Reading/listening practice texts |

The teacherrecord map tells you the *shape* of a credible course; the State Dept material is what you legally *fill it with*.
