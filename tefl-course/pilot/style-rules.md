# Style rules — embedded in every drafting prompt, enforced by the gate

Write like a print textbook from a serious publisher. Plain declarative sentences. Concrete classroom examples used sparingly. Vary sentence length naturally. One idea per paragraph, 3–6 sentences, joined by the logic of the content rather than transition words.

SPELLING: American English throughout (organize, recognize, behavior, color, center, practice, traveling, analyze, program). This is an American-English course.

NAMED EXAMPLES: use ONLY the recurring cast (see ../docs/cast.md) — learners Carlos, Daniel, Wei, Fatima, Yuki, Priya; teachers Ms. Reyes, Mr. Osei. Keep each character's gender consistent. Do not invent new names. Use a named vignette only when it genuinely clarifies a point — a few per unit at most, never one per paragraph. Vary how examples are introduced; do not open paragraph after paragraph with "Consider…".

CAST ROLES ARE FIXED (2026-07-17, enforced by `tefl-course-audit`):

- The six learners are ONLY ever learners. Never "a teacher named Carlos", never a trainee
  teacher, never an observer of someone else's class.
- The only named teachers are Ms. Reyes and Mr. Osei. A scene needing more teachers uses
  unnamed colleagues ("the teacher across the hall").
- Ages, countries, and first languages are fixed (cast.md). Yuki is a teenager; everyone
  else is an adult or young adult. No cast member may appear as a child.
- Scenes with child learners (young-learner units) use UNNAMED children ("a six-year-old
  near the door"), never cast names, never invented names.
- L1-specific error examples must match the speaker's actual L1, or use an unnamed learner
  with the L1 stated ("a Russian-speaking learner").

QUIZ ANCHORS: every `*Anchor: "..."` in a unit quiz, bank.json, or assessment key is a
VERBATIM quote of the source text (ellipses may bridge verbatim segments). Never paraphrase
inside an anchor or inside a keyed answer that says "the unit states". The audit verifies
this mechanically.

REFERENCES: no unit ships with an empty `## References` section; every in-text
(Author, Year) has a matching entry; internal filenames (e.g. `*_508` PDF names) never
appear in student-facing prose.

Do NOT open a unit or section with meta-framing ("The central argument of this unit is…", "This unit will explore…"). Start on the content.

BANNED — structures:

- Em dashes and double hyphens. Use commas, semicolons, or two sentences.
- "It's not X, it's Y" and every negation-then-assertion variant. State the positive claim.
- Rule-of-three flourishes ("clear, concise, and compelling").
- Rhetorical questions as openers. "Let's" anything.
- Lists of bare noun phrases; bolded inline headers inside lists.
- Uniform sentence rhythm; metronomic short-short-short or long-long-long runs.

BANNED — words and phrases (non-exhaustive; the detector enforces the full lists):
delve, tapestry, landscape, realm, journey, embark, beacon, robust, comprehensive, leverage, pivotal, crucial, seamless, foster, empower, unlock, unleash, elevate, harness, navigate, vibrant, nuanced, holistic, actionable, deep dive, unpack, game-changer, cutting-edge, "it is important to note", "worth noting", "in today's", "moreover", "furthermore", "additionally" (as sentence openers), "at the end of the day", "studies show" (name the study instead), "this guide will", "in this unit we will explore".

REQUIRED:

- Every factual claim about teaching effectiveness carries an inline citation (Author, Year) that appears in the unit's reference list.
- Examples use plausible classroom dialogue, marked T: (teacher) and S: (student).
- Definitions given once, plainly, on first use.
- The unit may say "research supports X" only with the named source attached.
