# Course-generation pipeline — design

For building the 120hr TEFL course on the [teacherrecord module skeleton](course-structure-reference.md) from the [public-domain seed corpus](business-research.md). Design decided 2026-06-07.

## Prime directive: zero AI-isms

The single most important constraint, set explicitly by the owner: **no LLM writing patterns anywhere in the published course.** "It's not X, it's Y" contrastives, delve/tapestry/comprehensive vocabulary, "Moreover," transitions, uniform sentence rhythm, chatbot closers — all of it is disqualifying. People cannot be reading slop. Open-ended LLM generation is the single most dangerous part of this pipeline, so the architecture minimizes it structurally and gates whatever remains.

## Architecture: source-first, generation-last

**Layer 0 — corpus.** Public-domain and licensed sources only: the US State Dept "Shaping the Way We Teach English" 14-module course + americanenglish.state.gov library (public domain, commercial reuse OK), VOA Learning English (public domain incl. commercial, with attribution), the owner's own textbooks, and named TESOL/SLA research. Every source gets a full citation record before any of its content moves downstream.

**Layer 1 — extraction (no generation).** Map source passages onto the teacherrecord module/unit skeleton verbatim or near-verbatim. The unit's substance comes FROM the sources; the LLM does not write teaching content from its own head. Like teacherrecord's own practice (which the owner specifically liked), every substantive claim carries a citation — author, year, work — and we go further than they did.

**Layer 2 — constrained drafting.** The LLM's only permitted jobs: ordering extracted material, writing short bridges between source passages, condensing, and drafting exercises/quiz items grounded in the extracted text. The drafting prompt embeds the banned-pattern catalog, requires textbook register, and forbids introducing claims not present in the source. Quiz questions must each be answerable by pointing at a specific passage in the unit, and that passage gets recorded with the question.

**Layer 3 — the enforcement gate (every unit, no exceptions).**

1. `dslop` — deterministic CLI lint (installed as a dev dep; strict `dslop.toml` to be tuned). Catches structural tells: em-dashes, contrastive negation, filler adverbs, rhythm statistics. Non-zero exit = unit rejected.
2. `tefl-course-detect-style` — course-local Python scorer covering what dslop misses: the three vocabulary tiers (delve/tapestry/leverage...), stock transitions, and chatbot artifacts. Score threshold: anything 20 or above is rejected.
3. avoid-ai-writing skill audit pass (P0 credibility killers → P2 polish) in detect mode, then targeted rewrite of flagged spans only.
4. Adversarial critic pass: a separate model instance asked to find any sentence that could not have come from the cited source or a print textbook. Flags loop back to Layer 2.
5. Human review (the owner reads English): final spot-check per unit. Nothing publishes without it.

**Layer 4 — curriculum uplift (separate workstream).** Take the curriculum a level above teacherrecord by folding in current research on how teaching should actually be done: task-based language teaching evidence, retrieval practice/spacing effects, current SLA findings. Needs a dedicated deep-research pass with named, citable papers; the output feeds Layer 0 as first-class sources.

## Tooling status (2026-06-07)

- `dslop==0.2.2` is installed as a `tefl-course` uv dev dependency; verified it flags contrastives/em-dashes/negation. Known gap: no vocabulary list — covered by the course-local style detector.
- The old repo-level Node detector has been replaced by `src/tefl_course/detectors/ai_style.py`, runnable as `uv run tefl-course-detect-style <file>`.
- Reference catalogs for prompt-embedding: dslop's rule list, the skill's SKILL.md, and Wikipedia's "Signs of AI writing."

## Not yet built

- The extractor (State Dept corpus → skeleton mapping) and citation store.
- The drafting prompts + `dslop.toml` + style-detector threshold tuning.
- The critic pass and the per-unit build script that chains the whole gate.
- The Layer-4 research pass.
