# Pilot unit spec — "Giving Feedback and Correcting Errors"

Slot: the error-correction/feedback unit (teacherrecord's mid9 Unit 3 territory, where their content has no evidence behind it). Audience: self-study trainee with no classroom experience. Target length: 2,200–3,000 words + quiz. Register: print textbook — plain declarative prose, concrete classroom examples, no enthusiasm.

## Source mapping (every section names its sources)

| Section | Content | Source |
| --- | --- | --- |
| 1. What feedback is and why it matters | feedback as information about performance; effects on learners (the "Aha" vs discouragement framing); positive/negative/unclear | State Dept Module 5 manual (public domain), pp. 45–46 |
| 2. Types of feedback | oral vs written; immediate vs delayed; teacher / peer / self; form vs content | Module 5 manual |
| 3. When and what to correct | accuracy vs fluency stages; selective correction; affective cost of over-correction | Module 5 manual + Lyster & Saito (2010) durability finding |
| 4. How to correct: the evidence | recasts vs prompts taxonomy; corrective feedback works and lasts (Lyster & Saito 2010, 15 classroom studies, N=827, prompts > recasts); corroborated by Li (2010, 33 studies) | verified citations (curriculum-research.md §4) |
| 5. Techniques in practice | 4–6 concrete techniques with classroom dialogue examples, adapted from the module's activities | Module 5 manual activities, rewritten student-facing |
| Quiz | 6 questions; each question records the section/passage that answers it | per pipeline design |

## Drafting constraints (Layer 2)

- No claim that is not in the Module 5 source text or the verified citations block. The model may reorganize, condense, and write bridging sentences and examples in the same register — nothing else.
- Citations inline as (Author, Year); the unit ends with a references list.
- Style rules in [style-rules.md](style-rules.md) are embedded in every drafting prompt and enforced by the gate afterward.

## Gate (Layer 3) — every draft, in order

1. `uv run dslop <file>` — must exit 0.
2. `node .claude/skills/avoid-ai-writing/detector/patterns.js` score — must be < 20 ("minimal AI signals" band).
3. avoid-ai-writing skill audit (P0/P1 must be zero).
4. Adversarial critic pass: any sentence that could not have come from the cited source or a print textbook gets flagged and rewritten.
5. Owner reads it.
