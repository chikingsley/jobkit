"""Draft the pilot unit ("Giving Feedback and Correcting Errors") section by section.

The pipeline skeleton in miniature (see docs/course-generation-pipeline.md): the model only
reorganizes the public-domain Module 5 source and the verified-citations block into student-facing
textbook prose, one section per call, with the style rules embedded in every prompt. Output goes to
`unit-error-correction.md`, which must then pass the gate (dslop, style detector, audit, critic,
owner) before it counts as anything.

Run from `tefl-course/`: `uv run tefl-course-pilot-draft`.
"""

from __future__ import annotations

import sys
from typing import cast

from tefl_course.llm import SuperwhisperClient
from tefl_course.paths import PROJECT_ROOT

PILOT = PROJECT_ROOT / "pilot"
OUT = PILOT / "unit-error-correction.md"

UNIT_TITLE = "Giving Feedback and Correcting Errors"

# The ONLY effectiveness claims the model may use, verbatim facts from
# docs/curriculum-research.md §4.
CITATIONS_BLOCK = """\
Verified research facts (the ONLY effectiveness claims you may make; cite as (Author, Year)):
- Lyster & Saito (2010), Studies in Second Language Acquisition 32(2), pages 265-302. Meta-analysis
  of 15 classroom studies, 827 learners in total. Findings: oral corrective feedback has significant
  effects on second language development and the effects last; prompts (feedback that pushes the
  student to correct themselves) produce larger effects than recasts (the teacher simply saying the
  correct form). Treatment-length results are non-monotonic; do not infer a simple duration
  advantage.
- Li (2010), Language Learning 60(2), pages 309-365. Meta-analysis of 33 studies. Corroborates that
  corrective feedback helps second language acquisition. Do NOT state a numeric effect size for it.
Do not invent, extend, or round these findings. Every other claim in the unit must come from the
source text below."""

SECTIONS: list[tuple[str, str, int]] = [
    (
        "What feedback is and why it matters",
        "Define feedback plainly (information a learner receives about their performance). Use the "
        "source's framing: feedback can encourage (the 'Aha' moment when a student finally "
        "understands) or discourage (anger, sadness, silence), and the same correction can land "
        "either way depending on how it is given. Introduce the source's three-way sort of "
        "feedback experiences: positive effect, negative effect, unclear. End with why a teacher "
        "should plan "
        "feedback deliberately instead of correcting on reflex.",
        420,
    ),
    (
        "Types of feedback",
        "Lay out the kinds of feedback a classroom actually contains, drawn from the source: oral "
        "versus written; immediate versus delayed; feedback from the teacher, from peers, and from "
        "the learner's own self-assessment; feedback on form (grammar, pronunciation) versus on "
        "content (ideas, meaning). One short concrete classroom illustration per distinction, not "
        "a catalogue.",
        480,
    ),
    (
        "When to correct, and what",
        "Selective correction. During fluency work (a student telling a story, a pair discussion), "
        "constant interruption stops the speaking the activity exists to produce; during accuracy "
        "work (a drill on the past tense), immediate correction is the point of the exercise. The "
        "teacher chooses errors worth treating: errors that block communication, errors in the "
        "language point being taught, and errors many students share. Over-correction has an "
        "affective cost the source insists on. Add that the research ahead shows corrective "
        "feedback is worth doing well, citing (Lyster & Saito, 2010) for durability only.",
        450,
    ),
    (
        "How to correct: what the evidence says",
        "The unit's spine. Define the two families of oral correction: recasts (the teacher "
        "repeats the student's sentence with the error fixed) and prompts (the teacher signals "
        "an error and pushes the student to fix it: clarification requests, repetition of the "
        "error with rising intonation, metalinguistic clues like 'past tense?', elicitation "
        "like 'He goed... he...?'). "
        "Give a short T:/S: dialogue for each. Then the evidence from the citations block: "
        "correction works, its effects last, and prompts beat recasts on average (Lyster & Saito, "
        "2010), with Li (2010) corroborating across 33 studies. Explain WHY prompts likely win "
        "(the student does the mental work of retrieving the correct form) in one restrained "
        "sentence presented as the standard interpretation, not as a proven mechanism.",
        560,
    ),
    (
        "Techniques in practice",
        "Four or five concrete techniques adapted from the source's workshop activities, rewritten "
        "for a teacher to use with students: delayed correction slots (note errors during fluency "
        "work, treat them on the board afterwards, anonymously); peer feedback with a simple "
        "rubric; self-correction time before the teacher steps in; the three-pile sort (what went "
        "well / what needs work / not sure) as a learner self-assessment habit; praise that names "
        "the specific thing done right rather than generic praise. Each technique: two or three "
        "sentences plus, where useful, a one-line classroom example.",
        520,
    ),
]

QUIZ_BRIEF = (
    "Write exactly 6 quiz questions for the unit below. Mix: 3 multiple-choice (4 options, one "
    "correct), 2 short-answer, 1 scenario question (a classroom situation, the trainee chooses and "
    "justifies a correction move). For EVERY question include an 'anchor' field: a verbatim quote "
    "of at most 15 words from the unit text that contains the answer. Return ONLY a JSON object "
    '{"questions": [{"type": "...", "question": "...", "options": [...] or null, '
    '"answer": "...", "anchor": "..."}]}.'
)


def build_section_prompt(  # noqa: PLR0913 - one keyworded prompt-assembly helper; trivial.
    *, style_rules: str, source: str, title: str, brief: str, words: int, previous_tail: str
) -> str:
    """Assemble the full drafting prompt for one section."""
    parts = [
        "You are writing one section of a unit in a self-study TEFL certificate course. "
        f'The unit is called "{UNIT_TITLE}". Write ONLY the section named below, about '
        f"{words} words, in the register required by the style rules. Return ONLY a JSON object "
        '{"text": "..."} containing the section prose (no heading, no signature).',
        "",
        "== STYLE RULES (violations are rejected by an automated gate) ==",
        style_rules,
        "",
        "== " + CITATIONS_BLOCK,
        "",
        "== SOURCE TEXT (US State Dept, public domain — the unit's factual basis) ==",
        source,
        "",
        f"== SECTION TO WRITE: {title} ==",
        brief,
    ]
    if previous_tail:
        parts += [
            "",
            "== END OF THE PREVIOUS SECTION (continue naturally from this; do not repeat it) ==",
            previous_tail,
        ]
    return "\n".join(parts)


def main() -> None:
    """Draft all sections and the quiz, and write the assembled unit file."""
    style_rules = (PILOT / "style-rules.md").read_text(encoding="utf-8")
    source = (PILOT / "source-module5-learner-feedback.txt").read_text(encoding="utf-8")

    client = SuperwhisperClient()
    try:
        chunks: list[str] = [f"# {UNIT_TITLE}\n"]
        previous_tail = ""
        for title, brief, words in SECTIONS:
            prompt = build_section_prompt(
                style_rules=style_rules,
                source=source,
                title=title,
                brief=brief,
                words=words,
                previous_tail=previous_tail,
            )
            parsed = client.generate_json(
                [{"role": "user", "content": prompt}], max_tokens=int(words * 2.2)
            )
            fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
            text = str(fields.get("text", "")).strip()
            if not text:
                sys.exit(f"empty draft for section {title!r}")
            chunks.append(f"\n## {title}\n\n{text}\n")
            previous_tail = text[-600:]
            print(f"drafted: {title} ({len(text.split())} words)", file=sys.stderr)

        unit_so_far = "\n".join(chunks)
        quiz_prompt = (
            f"{QUIZ_BRIEF}\n\n== STYLE RULES ==\n{style_rules}\n\n== THE UNIT ==\n{unit_so_far}"
        )
        parsed = client.generate_json([{"role": "user", "content": quiz_prompt}], max_tokens=1600)
        quiz = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
        questions = quiz.get("questions", [])
        items = cast("list[object]", questions) if isinstance(questions, list) else []
        chunks.append(_render_quiz(items))
        chunks.append(
            "\n## References\n\n"
            "- Li, S. (2010). The effectiveness of corrective feedback in SLA: A meta-analysis. "
            "*Language Learning*, 60(2), 309-365.\n"
            "- Lyster, R., & Saito, K. (2010). Oral feedback in classroom SLA: A meta-analysis. "
            "*Studies in Second Language Acquisition*, 32(2), 265-302.\n"
            "- U.S. Department of State. *Shaping the Way We Teach English*, Module 5: Learner "
            "Feedback. americanenglish.state.gov (public domain).\n"
        )
        OUT.write_text("\n".join(chunks), encoding="utf-8")
        print(f"wrote {OUT}", file=sys.stderr)
    finally:
        client.close()


def _render_quiz(questions: list[object]) -> str:
    """Render the quiz questions (with their source anchors) as markdown."""
    lines = ["\n## Check your understanding\n"]
    for i, raw in enumerate(questions, 1):
        if not isinstance(raw, dict):
            continue
        q = cast("dict[str, object]", raw)
        lines.append(f"**{i}. {q.get('question', '')}**\n")
        options = q.get("options")
        if isinstance(options, list):
            lines += [f"   {chr(96 + j)}. {opt}" for j, opt in enumerate(options, 1)]
            lines.append("")
        lines.append(f"   *Answer: {q.get('answer', '')}*")
        lines.append(f'   *Anchor: "{q.get("anchor", "")}"*\n')
    return "\n".join(lines)


if __name__ == "__main__":
    main()
