"""Wave 1 unit registry — the corpus-covered units (course-blueprint.md, status ✅).

Each unit maps to: its blueprint id/title, the extracted State Dept source text file(s) that carry
it, a scope note steering the outline stage, and the verified-citation facts (if any) it is allowed
to use. Units 1.3 and 10.6 (companion-sourced) are deferred to batch 1b — they need section
extraction from the 204-page companion first.
"""

from __future__ import annotations

from dataclasses import dataclass, field

TEXT_DIR = "sources/state-dept-shaping/text"

# Verified citation facts, reused across units (from curriculum-research.md §4 — never extend).
CF_FACTS = """\
- Lyster & Saito (2010), Studies in Second Language Acquisition 32(2), 265-302. Meta-analysis of
  15 classroom studies (827 learners): oral corrective feedback has significant, durable effects;
  prompts (pushing the student to self-correct) beat recasts (teacher restates the correct form);
  longer treatments produce larger effects.
- Li (2010), Language Learning 60(2), 309-365. Meta-analysis of 33 studies; corroborates that
  corrective feedback helps acquisition. Do NOT state a numeric effect size."""

GRAMMAR_FACTS = """\
- Norris & Ortega (2000), Language Learning 50(3), 417-528. Meta-analysis of 49 studies: focused
  L2 instruction produces large gains; explicit instruction beats implicit; Focus on Form and
  Focus on Forms produce equivalent, large effects.
- Spada & Tomita (2010), Language Learning 60(2), 263-308. 41 studies: explicit instruction shows
  larger effects than implicit for BOTH simple and complex grammar.
- Goo, Granena, Yilmaz & Novella (2015), in Rebuschat (Ed.), Implicit and Explicit Learning of
  Languages, Benjamins, 443-482. 34 studies: replicates explicit > implicit.
- Kang, Sok & Han (2019), Language Teaching Research 23(4), 428-453. 35 years of form-focused
  instruction: only a minor explicit/implicit difference; outcome-measure type, learner
  proficiency, setting, and intensity moderate the effects. Teach the caveat: the explicit
  advantage partly reflects tests that favor explicit knowledge."""


@dataclass(frozen=True)
class Unit:
    """One producible unit: blueprint identity, sources, scope, and allowed citations."""

    uid: str
    title: str
    module: str
    sources: tuple[str, ...]
    scope: str
    citation_facts: str = ""
    references: tuple[str, ...] = field(default_factory=tuple)


_SD = (
    "U.S. Department of State. *Shaping the Way We Teach English*, {m}. "
    "americanenglish.state.gov (public domain)."
)

_REF_LS = (
    "Lyster, R., & Saito, K. (2010). Oral feedback in classroom SLA: A meta-analysis. "
    "*Studies in Second Language Acquisition*, 32(2), 265-302."
)
_REF_LI = (
    "Li, S. (2010). The effectiveness of corrective feedback in SLA: A meta-analysis. "
    "*Language Learning*, 60(2), 309-365."
)
_REF_NO = (
    "Norris, J. M., & Ortega, L. (2000). Effectiveness of L2 instruction: A research "
    "synthesis and quantitative meta-analysis. *Language Learning*, 50(3), 417-528."
)
_REF_ST = (
    "Spada, N., & Tomita, Y. (2010). Interactions between type of instruction and type of "
    "language feature: A meta-analysis. *Language Learning*, 60(2), 263-308."
)
_REF_GOO = (
    "Goo, J., Granena, G., Yilmaz, Y., & Novella, M. (2015). Implicit and explicit "
    "instruction in L2 learning. In P. Rebuschat (Ed.), *Implicit and Explicit Learning of "
    "Languages* (pp. 443-482). John Benjamins."
)
_REF_KANG = (
    "Kang, E. Y., Sok, S., & Han, Z. (2019). Thirty-five years of ISLA on form-focused "
    "instruction: A meta-analysis. *Language Teaching Research*, 23(4), 428-453."
)

UNITS: dict[str, Unit] = {
    u.uid: u
    for u in [
        Unit(
            uid="4.2",
            title="Contextualizing Language",
            module="M4 — Teaching Methods",
            sources=("module1contextualizglanguage.txt",),
            scope=(
                "Why language presented in context beats isolated forms: meaningful situations, "
                "discovery of language in use, the source's construction-site discovery task as a "
                "worked example. How to build context from tasks students already understand."
            ),
            references=(_SD.format(m="Module 1: Contextualizing Language"),),
        ),
        Unit(
            uid="4.5",
            title="Teaching Grammar: Explicit, Implicit, and the Evidence",
            module="M4 — Teaching Methods",
            sources=("module2-buildinglanguageawareness.txt",),
            scope=(
                "How grammar teaching actually works: noticing and language awareness from the "
                "source, then the unit's spine — the verified meta-analytic evidence that explicit "
                "instruction outperforms implicit, including for complex forms, WITH the "
                "measurement caveat (tests favor explicit knowledge; the gap narrows on "
                "communicative measures). Close with what this means practically: teach forms "
                "openly, then drive them into communicative use."
            ),
            citation_facts=GRAMMAR_FACTS,
            references=(
                _REF_GOO,
                _REF_KANG,
                _REF_NO,
                _REF_ST,
                _SD.format(m="Module 2: Building Language Awareness"),
            ),
        ),
        Unit(
            uid="5.4",
            title="Building Language Awareness",
            module="M5 — Vocabulary",
            sources=("module2-buildinglanguageawareness.txt",),
            scope=(
                "Language awareness as a learner skill: noticing patterns, guessing meaning from "
                "context, word families and collocation, awareness-raising activities from the "
                "source. Distinct from unit 4.5 (which uses the same source for the grammar-"
                "teaching evidence): this unit is about the LEARNER's developing awareness of "
                "vocabulary and patterns, not the teacher's methodology verdict."
            ),
            references=(_SD.format(m="Module 2: Building Language Awareness"),),
        ),
        Unit(
            uid="7.2",
            title="Teaching Reading",
            module="M7 — Receptive Skills",
            sources=("module3integratingskills.txt",),
            scope=(
                "Reading as a taught skill: pre-reading, while-reading, post-reading staging from "
                "the source's integrated-skills lesson; top-down vs bottom-up processing in plain "
                "terms; choosing texts; reading tasks that check comprehension without killing "
                "interest. Focus on the reading thread of the source; integration itself is unit "
                "8.5's job."
            ),
            references=(_SD.format(m="Module 3: Integrating Skills"),),
        ),
        Unit(
            uid="7.4",
            title="Authentic Materials",
            module="M7 — Receptive Skills",
            sources=("module8-authentic-materials.txt",),
            scope=(
                "What authentic materials are, why they motivate, and how to grade the TASK rather "
                "than the text. The source's examples of adapting real-world material (menus, "
                "schedules, broadcasts) to different levels; risks (cultural load, difficulty) and "
                "how to manage them."
            ),
            references=(_SD.format(m="Module 8: Authentic Materials"),),
        ),
        Unit(
            uid="8.2",
            title="Pair and Group Work",
            module="M8 — Productive Skills",
            sources=("module4-pairwordgroupwork.txt",),
            scope=(
                "Why pair/group work multiplies speaking time; the source's interaction patterns, "
                "grouping techniques, role assignment, and management of noise/L1 drift; setting "
                "up, monitoring, and closing group tasks; what the teacher does while groups work."
            ),
            references=(_SD.format(m="Module 4: Pair and Group Work"),),
        ),
        Unit(
            uid="8.5",
            title="Integrating the Four Skills",
            module="M8 — Productive Skills",
            sources=("module3integratingskills.txt",),
            scope=(
                "Why real communication mixes skills and lessons can too: the source's integrated "
                "lesson as the worked example, theme-based sequencing (reading feeds speaking "
                "feeds writing), and how to keep one skill as the lesson's spine while others "
                "support it."
            ),
            references=(_SD.format(m="Module 3: Integrating Skills"),),
        ),
        Unit(
            uid="9.2",
            title="Learner Feedback in Practice",
            module="M9 — Feedback & Error Correction",
            sources=("module5-learning-feedback.txt",),
            scope=(
                "The practical companion to unit 9.1 (already built — assume the reader knows "
                "recasts vs prompts and the evidence): feedback routines you can install — board "
                "slots, feedback on written work, praise that names the behavior, peer and "
                "self-assessment habits, and the source's guidance on keeping feedback "
                "encouraging. Do NOT re-teach the meta-analysis; reference it in passing at most."
            ),
            citation_facts=CF_FACTS,
            references=(_REF_LI, _REF_LS, _SD.format(m="Module 5: Learner Feedback")),
        ),
        Unit(
            uid="9.3",
            title="Mistakes, Errors, and What They Tell You",
            module="M9 — Feedback & Error Correction",
            sources=("module5-learning-feedback.txt",),
            scope=(
                "Diagnosis: the source's mistake-vs-error distinction (carelessness vs gap in the "
                "developing system), interlanguage in plain terms, errors as evidence of learning, "
                "and how analyzing what students get wrong shapes what to teach next. Light "
                "touch on correction technique (that is 9.1's job)."
            ),
            citation_facts=CF_FACTS,
            references=(_REF_LI, _REF_LS, _SD.format(m="Module 5: Learner Feedback")),
        ),
        Unit(
            uid="11.1",
            title="Managing Large Classes",
            module="M11 — Classroom Management",
            sources=("module6-managing-large-classes.txt",),
            scope=(
                "The source's large-class realities and techniques: routines, names, voice and "
                "position, pair/group structures that scale, monitoring and feedback when you "
                "cannot reach everyone, and keeping weaker students engaged in a class of 40-60."
            ),
            references=(_SD.format(m="Module 6: Managing Large Classes"),),
        ),
        Unit(
            uid="12.1",
            title="Individual Learner Differences",
            module="M12 — Knowing Your Learners",
            sources=("module-11-indidvidual-learner-differences_1.txt",),
            scope=(
                "How learners genuinely differ: age, proficiency, motivation, personality, "
                "background, needs — and how teachers can respond (variety, choice, scaffolding). "
                "CAUTION: if the source mentions learning styles, present them strictly as "
                "preferences students may report, NEVER as something matching instruction to "
                "improves learning — unit 12.2 handles that evidence. Do not contradict 12.2."
            ),
            references=(_SD.format(m="Module 11: Individual Learner Differences"),),
        ),
        Unit(
            uid="12.3",
            title="Learning Strategies",
            module="M12 — Knowing Your Learners",
            sources=("module7-learning-strategies.txt",),
            scope=(
                "Teachable strategies from the source: cognitive, metacognitive, and social "
                "strategies; strategy training inside normal lessons; helping learners study "
                "between classes. Concrete strategy-instruction examples over taxonomy."
            ),
            references=(_SD.format(m="Module 7: Learning Strategies"),),
        ),
        Unit(
            uid="13.2",
            title="Alternative Assessment",
            module="M13 — Assessment & Testing",
            sources=("module10-alternative-assessment.txt",),
            scope=(
                "Beyond the discrete-point test: portfolios, projects, self- and peer-assessment, "
                "performance tasks, rubrics — the source's options with their strengths, costs, "
                "and classroom fit. When alternative assessment beats a quiz and when it does not."
            ),
            references=(_SD.format(m="Module 10: Alternative Assessment"),),
        ),
        Unit(
            uid="14.1",
            title="Teaching Young Learners",
            module="M14 — Specializations",
            sources=("module-12-younger-learners-k-5_0.txt",),
            scope=(
                "K-5 realities from the source: attention spans, movement, play and songs, "
                "routines, storytelling, the difference between teaching children and teaching "
                "small adults; classroom management for children; what progress looks like."
            ),
            references=(_SD.format(m="Module 12: Younger Learners K-5"),),
        ),
        Unit(
            uid="14.3",
            title="Critical and Creative Thinking",
            module="M14 — Specializations",
            sources=("module9-criticalandcreativethinking.txt",),
            scope=(
                "Building thinking into language tasks: the source's question hierarchies (from "
                "recall to analysis to creation), open tasks with many right answers, and why "
                "thinking tasks produce richer language than display questions."
            ),
            references=(_SD.format(m="Module 9: Critical and Creative Thinking"),),
        ),
        Unit(
            uid="14.4",
            title="Reflective Teaching, Peer Observation, and Growing on the Job",
            module="M14 — Specializations",
            sources=("module-13-peer-observation.txt", "module-14-reflective-teaching.txt"),
            scope=(
                "The working teacher's improvement loop from the two sources: reflection routines "
                "(journals, recordings, self-questions), peer observation done as colleagues "
                "rather than evaluation, and turning observations into one concrete change at a "
                "time."
            ),
            references=(
                _SD.format(m="Module 13: Peer Observation"),
                _SD.format(m="Module 14: Reflective Teaching"),
            ),
        ),
    ]
}
