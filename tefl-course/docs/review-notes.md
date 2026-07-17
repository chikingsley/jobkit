# Course review notes — a high-level read (2026-06-09)

> **SUPERSEDED (2026-07-17):** the aggregate issues flagged here, plus the defects the 06-09
> cast remap introduced, were fully resolved in the 2026-07-17 repair pass. See
> [review-2026-07-17.md](review-2026-07-17.md) for the current state and the new enforcement
> gate. This file is kept as the historical first read.


> **STATUS (2026-06-09): Tier 1 + Tier 2 polish applied.** American spelling normalized course-wide
> (~500 fixes); the ~60 scattered names consolidated onto a deliberate 6-learner + 2-teacher cast
> (see [cast.md](cast.md)), gender-aware and pronoun-checked, with unit 2.5's L1 examples
> hand-aligned; the one meta-framing opener removed; clustered "Consider" openers varied (102→83).
> Style rules updated so future generation inherits all of it. Concept-dedup (#3) intentionally
> LEFT as-is: in a modular course a one-line definition per unit is correct, not redundant. Course
> wrapper (#6) is the remaining real work. Original read below.

My own read of the 62 drafted units, in context, against the source material (State Dept corpus, the Interchange/Passages/Grammar & Beyond books in the archive) and the gate. Not a rewrite plan and nothing forced — a vibe-check with the evidence behind each call, ranked by whether I'd actually bother.

## Wrapper-pass catches (2026-06-09, during test building)

- **Unit 9.1 was missing from `units/`** — the pilot was never promoted out of `pilot/`; the course had silently been 62/63. Promoted, registered, gated. The course is 63 units.
- **Blueprint header said "57 units"** while its own module tables always summed to 63. Header fixed.
- **6.2 (Phonemic Chart) was framed entirely around British RP** in an American-English course, and described learner Carlos as a "speaker of a variety of English." Rewritten: RP origin acknowledged, American differences (rhoticity, vowel mergers) stated, principle-transfers point made.

## The honest headline

Read one unit at a time, the writing is genuinely good: clear, accurate, faithful to source, well sequenced, no purple prose. Nothing reads as "slop" in isolation. The problems are all **aggregate** — patterns you only feel reading the whole course, and they're the things that quietly say "a machine wrote this." Every one is mechanical to fix without touching the substance.

## Tier 1 — worth doing (real lift, low risk)

### 1. The same handful of named students, over and over

- **658 named-student/teacher vignettes** across the course. The names barely vary: **Carlos appears 87 times, Fatima 68, Yuki 47, Priya 45, Amara 45.** A learner doing the whole course meets "a student named Carlos" 87 times.
- This is **not** how the genre writes. The State Dept corpus (~124k words) uses "named X" **5 times total**; the Interchange Teacher's Book uses it **0 times in 60 pages**. The pattern is pure model habit, not faithfulness to the source.
- Options: cut vignette density to ~2-3 per unit AND draw names from a wider pool; OR (more interesting) lean in deliberately — adopt a small *intentional* recurring cast of 5-6 learners with consistent backgrounds, used on purpose across the course so it reads as a designed through-line instead of a tic. The second turns the bug into a feature.

### 2. Mixed British / American spelling

- **36 units use British -ise/-isation** (organise, recognise, emphasise), **25 use American -ize/-ization.** Many units mix both internally.
- This is an **American English** course (State Dept "American English", Interchange American edition, the user's market). It should be consistently American. Mixed spelling in a paid product reads as careless. Pure find-replace with a hand-check on edge cases (e.g. "exercise", "advertise" stay).

### 3. Same concepts re-defined from scratch in multiple units

- "A meta-analysis is…" is explained fresh in **4.4, 5.2, and 7.3**. "Effect size" is defined in **4.4 and 7.3**. "Comprehensible input" is introduced in **five** units.
- In a sequential course this reads as repetitive and slightly insulting to a reader who just learned it. Define once (or in a short glossary), then reference. This is also a sequencing question the module-test/intro pass should settle.

## Tier 2 — stylistic polish (do if we're already in there)

### 4. Reused openers and meta-framing

- **"Consider…" opens 102 sentences** course-wide; "Imagine…", "Picture…", "That distinction…" recur as a small fixed set of paragraph-starters.
- A few units open with **"The central argument of this unit is…"** / "This unit will…" meta-framing — fine once, formulaic across a course.
- Fix is just variety: vary openers, cut the meta-framing, let some paragraphs start on the content.

### 5. Dialogue examples (T:/S:) are good but patterned

- The little classroom exchanges are one of the better features — concrete and on-point. But they follow a near-identical rhythm (teacher prompts, student gives the textbook-wrong answer, teacher confirms the rule). Worth varying the shape of a few so they don't all land the same beat.

## Tier 3 — structural / not "fixes"

### 6. The course wrapper is still unbuilt

- No module tests, final exam, or course intro yet — always the planned last step once unit content stabilized. This is construction, not polish; flagging so it's not forgotten.

### 7. Possible thinning

- A few units run long for their topic (the grammar units sit at ~3.1-3.3k words). Not a problem, but if we touch them, some could lose 10-15% with no loss of substance.

## What I would NOT change

- The content, the citations (now verified to the derived-number level post-Codex), the grammar accuracy, the structure, the register. Those are solid. The fixes above are all surface — voice and consistency, not substance.

## If we act

Tier 1 is the high-value set and it's where I'd focus. My suggestion for *how*, honoring "your read, not a model's rewrite": I hand the per-unit edits to a subagent with a tight, mechanical brief (the name pool / spelling rule / dedup map I'd define from this analysis), **I review every diff**, the set re-runs the gate, and Codex does the final pass. The judgment (what to change, which names, what to dedup) stays mine and lives in this file; the typing is delegated.
