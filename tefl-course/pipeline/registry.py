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
    """One producible unit: blueprint identity, source strategy, scope, and allowed citations.

    `mode` selects where the unit's source text comes from:
    - "corpus": exact State Dept module text files in `sources` (Wave 1).
    - "retrieval": keyword search over the public-domain corpus via `retrieval_query` (Wave 2).
    - "facts": no source text; the model writes from uncopyrightable facts (English grammar,
      standard ELT practice) with its own examples, gated and human-reviewed (Wave 3).
    """

    uid: str
    title: str
    module: str
    scope: str
    sources: tuple[str, ...] = field(default_factory=tuple)
    mode: str = "corpus"
    retrieval_query: str = ""
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

# --- additional verified citation facts (curriculum-research.md §4) ---------------------------

GREGG_FACT = (
    "- Gregg (1984), Applied Linguistics 5(2), 79-100. A foundational critique arguing Krashen's "
    "Monitor Model (incl. the Input Hypothesis) is not empirically testable as stated. Use ONLY "
    "to support: comprehensible input matters, but the STRONG input hypothesis is untestable; "
    "present Krashen as historically influential, not settled science."
)
HALL_COOK_FACT = (
    "- Hall & Cook (2012), Language Teaching 45(3), 271-308. State-of-the-art review documenting "
    "the field's shift away from the English-only monolingual assumption toward judicious use of "
    "the learner's own language. Use to support: English-mainly, not English-only."
)
TBLT_FACTS = (
    "- Bryfonski & McKay (2019), Language Teaching Research 23(5), 603-632. Meta-analysis of 52 "
    "studies: a positive effect of task-based language teaching (reported d = 0.93).\n"
    "- Xuan, Cheung & Liu (2025), Language Teaching Research 29(7). Re-analysis correcting that "
    "estimate to a more modest g = 0.61, citing loose inclusion criteria. TEACH the tighter g = "
    "0.61 as the headline; present d = 0.93 as the disputed original. Direction settled, magnitude "
    "contested."
)
RETRIEVAL_FACTS = (
    "- Karpicke & Roediger (2008), Science 319(5865), 966-968. Foreign-language vocabulary "
    "(Swahili-English): repeated retrieval (testing) produced a large delayed-recall advantage "
    "(~80% vs ~33% at one week), while repeated STUDYING after the first correct recall had no "
    "measurable effect. Do not invent further numbers."
)
SPACING_FACTS = (
    "- Nakata (2015), Studies in Second Language Acquisition 37(4), 677-711. Spaced practice beats "
    "massed for L2 vocabulary; expanding schedules show a limited but significant edge over equal "
    "spacing.\n"
    "- Kim & Webb (2022), Language Learning 72(1), 269-319. Meta-analysis (48 experiments, "
    "N=3,411) confirming spaced practice benefits L2 learning. Do not state a single pooled effect "
    "size beyond 'a positive effect'."
)
EXTENSIVE_READING_FACTS = (
    "- Nakanishi (2015), TESOL Quarterly 49(1), 6-37. Meta-analysis (34 studies): extensive "
    "reading improves reading proficiency (group comparisons d = 0.46; pre-post d = 0.71).\n"
    "- Jeon & Day (2016), Reading in a Foreign Language 28(2), 246-265. Meta-analysis (49 "
    "studies): experimental-vs-control d = 0.57; pre-post d = 0.79. KEEP the two studies' numbers "
    "separate; never merge them.\n"
    "- Hamada (2020): cautions that selection bias inflates these (adjusted ~d 0.37). Mention as a "
    "caveat without a precise claim beyond that figure."
)
LEARNING_STYLES_FACTS = (
    "- Pashler, McDaniel, Rohrer & Bjork (2009), Psychological Science in the Public Interest "
    "9(3), 105-119. Found no adequate evidence that matching instruction to a learner's diagnosed "
    "'style' improves learning; the meshing hypothesis fails properly designed tests.\n"
    "- Willingham, Hughes & Dobolyi (2015), Teaching of Psychology 42(3), 266-271. Reinforces "
    "that learning-styles theories lack scientific support. TEACH learning styles as a popular but "
    "debunked idea; the evidence-supported response to learner differences is VARIETY of activity "
    "formats, not style-matching."
)

_REF_GREGG = (
    "Gregg, K. R. (1984). Krashen's Monitor and Occam's Razor. *Applied Linguistics*, 5(2), "
    "79-100."
)
_REF_HALL_COOK = (
    "Hall, G., & Cook, G. (2012). Own-language use in language teaching and learning. *Language "
    "Teaching*, 45(3), 271-308."
)
_REF_BM = (
    "Bryfonski, L., & McKay, T. H. (2019). TBLT implementation and evaluation: A meta-analysis. "
    "*Language Teaching Research*, 23(5), 603-632."
)
_REF_XUAN = (
    "Xuan, Q., Cheung, A., & Liu, J. (2025). How effective is task-based language teaching? A "
    "technical comment on Bryfonski and McKay (2019). *Language Teaching Research*, 29(7)."
)
_REF_KR = (
    "Karpicke, J. D., & Roediger, H. L. (2008). The critical importance of retrieval for "
    "learning. *Science*, 319(5865), 966-968."
)
_REF_NAKATA = (
    "Nakata, T. (2015). Effects of expanding and equal spacing on second language vocabulary "
    "learning. *Studies in Second Language Acquisition*, 37(4), 677-711."
)
_REF_KW = (
    "Kim, S. K., & Webb, S. (2022). The effects of spaced practice on second language learning: A "
    "meta-analysis. *Language Learning*, 72(1), 269-319."
)
_REF_NAKANISHI = (
    "Nakanishi, T. (2015). A meta-analysis of extensive reading research. *TESOL Quarterly*, "
    "49(1), 6-37."
)
_REF_JEON = (
    "Jeon, E.-Y., & Day, R. R. (2016). The effectiveness of ER on reading proficiency: A "
    "meta-analysis. *Reading in a Foreign Language*, 28(2), 246-265."
)
_REF_PASHLER = (
    "Pashler, H., McDaniel, M., Rohrer, D., & Bjork, R. (2009). Learning styles: Concepts and "
    "evidence. *Psychological Science in the Public Interest*, 9(3), 105-119."
)
_REF_WILLINGHAM = (
    "Willingham, D. T., Hughes, E. M., & Dobolyi, D. G. (2015). The scientific status of learning "
    "styles theories. *Teaching of Psychology*, 42(3), 266-271."
)
_SD_ACTIVITIES = "U.S. Department of State. {t}. americanenglish.state.gov (public domain)."

# Reusable retrieval-corpus reference (the companion volume, public domain).
_REF_COMPANION = (
    "U.S. Department of State. *Shaping the Way We Teach English: From Observation to Action*. "
    "americanenglish.state.gov (public domain)."
)


def _r(query: str, scope: str, **kw: object) -> dict[str, object]:
    """Shorthand for a retrieval-mode unit body (mode + query + companion reference baseline)."""
    refs = tuple(kw.pop("references", ()) or ()) or (_REF_COMPANION,)
    return {"mode": "retrieval", "retrieval_query": query, "scope": scope, "references": refs, **kw}


# Wave 2 (retrieval) + Wave 3 (facts) units. Scopes steer the outline; the gate + human review +
# Codex audit catch drift. Grammar/phonology "facts" units write from uncopyrightable facts with
# their own examples — no copyrighted textbook text is ever fed in.
_WAVE23: list[Unit] = [
    # --- M1 The TEFL World ---
    Unit(uid="1.1", title="The World of TEFL: Markets, Learners, and Contexts",
         module="M1 — The TEFL World",
         **_r("teaching English abroad contexts learners young adult primary secondary classroom "
              "where English is taught countries motivation reasons learners",
              "Orient a brand-new teacher to the field: who learns English and why, the range of "
              "contexts (young learners to adults, private/public/online), what differs across "
              "them, and what the job actually involves. Broad and welcoming; no methodology "
              "depth (later modules do that).")),
    Unit(uid="1.2", title="How People Learn Languages: First Language, Second Language, and Input",
         module="M1 — The TEFL World",
         **_r("how learners acquire language input comprehension exposure first language second "
              "language meaning understanding listening",
              "Plain-English orientation to acquisition: L1 vs L2, the central role of "
              "comprehensible input, and an HONEST note on theory. Use Gregg (1984) for the point "
              "that input matters but the strong Input Hypothesis is untestable, and Hall & Cook "
              "(2012) for judicious use of the learner's own language. No deep SLA jargon.",
              citation_facts=GREGG_FACT + "\n" + HALL_COOK_FACT,
              references=(_REF_GREGG, _REF_HALL_COOK, _REF_COMPANION))),
    Unit(uid="1.3", title="What Makes an Effective Teacher",
         module="M1 — The TEFL World",
         **_r("effective teacher qualities classroom rapport preparation clarity caring "
              "enthusiasm professional reflection what good teachers do",
              "What distinguishes effective teachers: preparation, clarity, rapport, fairness, "
              "adaptability, reflection. Concrete classroom behaviours over personality traits.")),
    Unit(uid="1.4", title="Levels and Proficiency: From Beginner to Advanced",
         module="M1 — The TEFL World", mode="facts",
         scope=(
             "Explain proficiency levels a teacher must read and plan for: the traditional bands "
             "(beginner, elementary, pre-intermediate, intermediate, upper-intermediate, "
             "advanced) and a plain orientation to the CEFR scale (A1-C2) as a common reference. "
             "What learners can typically do at each level and how it changes lesson choices. "
             "These are factual frameworks; describe CEFR's level descriptors in your own words "
             "(do not reproduce the Council of Europe's exact descriptor text)."),
         references=(
             "Council of Europe. *Common European Framework of Reference for Languages* (CEFR) — "
             "described, not reproduced.",
         )),
    Unit(uid="1.5", title="First Lessons: Setting the Stage and Breaking the Ice",
         module="M1 — The TEFL World",
         **_r("first lesson icebreaker getting to know students names classroom routines warm-up "
              "establishing rapport beginning of course activities",
              "The practical first-day toolkit: setting expectations and routines, learning names, "
              "icebreakers that double as language practice, and reducing first-day anxiety. "
              "Concrete activities a new teacher can run on day one.")),
    # --- M2 Grammar for Teachers I (facts) ---
    Unit(uid="2.1", title="Grammatical Terms and the Parts of Speech",
         module="M2 — English Grammar for Teachers I", mode="facts",
         scope=(
             "The teacher's working vocabulary for grammar: the parts of speech (noun, verb, "
             "adjective, adverb, pronoun, preposition, conjunction, determiner, etc.) with clear "
             "definitions and your own example sentences, plus why a teacher needs the "
             "metalanguage "
             "even if students do not. Accurate, standard descriptive grammar; invent all "
             "examples; reproduce no textbook's wording.")),
    Unit(uid="2.2", title="Sentence Structure",
         module="M2 — English Grammar for Teachers I", mode="facts",
         scope=(
             "How English sentences are built: subject-verb-object order, clauses (main vs "
             "subordinate), phrases, and the simple/compound/complex distinction, with your own "
             "examples. Practical for a teacher explaining word order to learners. Standard facts; "
             "original examples only.")),
    Unit(uid="2.3", title="The Tense System: Time, Tense, and Aspect",
         module="M2 — English Grammar for Teachers I", mode="facts",
         scope=(
             "Disentangle time (past/present/future as concepts), tense (the verb forms), and "
             "aspect (simple, continuous, perfect, perfect continuous). Explain why English has no "
             "simple 'future tense' and how aspect carries meaning. Your own example sentences and "
             "timelines described in words. Accurate descriptive grammar.")),
    Unit(uid="2.4", title="The Twelve Forms in Use",
         module="M2 — English Grammar for Teachers I", mode="facts",
         scope=(
             "Walk through the twelve common verb forms (simple/continuous/perfect/perfect-"
             "continuous across past/present/future) with a typical use and one original example "
             "each, focused on the MEANING each conveys and the learner confusions to expect. "
             "Standard facts; invent every example.")),
    Unit(uid="2.5", title="Common Learner Errors by First-Language Background",
         module="M2 — English Grammar for Teachers I", mode="facts",
         scope=(
             "How a learner's first language shapes the errors they make in English (articles, "
             "word order, tense, prepositions, pronunciation-driven spelling), with realistic "
             "examples across a few common L1 backgrounds, and what a teacher does about it. Frame "
             "errors as predictable and diagnosable. General, well-established contrastive "
             "observations; invent the example sentences; do not caricature any group.")),
    # --- M3 Grammar for Teachers II (facts) ---
    Unit(uid="3.1", title="Modal Verbs",
         module="M3 — English Grammar for Teachers II", mode="facts",
         scope=(
             "Modal verbs (can, could, may, might, must, shall, should, will, would) and common "
             "semi-modals: their forms and the meanings they carry (ability, permission, "
             "obligation, possibility, advice), with your own examples and the typical learner "
             "difficulties. Standard descriptive grammar; original examples.")),
    Unit(uid="3.2", title="Conditionals",
         module="M3 — English Grammar for Teachers II", mode="facts",
         scope=(
             "The conditional patterns (zero, first, second, third, and mixed) by form and "
             "meaning, what real vs unreal conditions express, and how to teach them without the "
             "rules becoming a maze. Your own example sentences. Accurate facts only.")),
    Unit(uid="3.3", title="Reported Speech",
         module="M3 — English Grammar for Teachers II", mode="facts",
         scope=(
             "Reported (indirect) speech: backshift of tense, changes to pronouns and time/place "
             "words, reporting verbs, and reported questions and commands, with original examples "
             "and the points learners trip on. Standard grammar; invent all examples.")),
    Unit(uid="3.4", title="Phrasal Verbs",
         module="M3 — English Grammar for Teachers II", mode="facts",
         scope=(
             "Phrasal verbs: what they are, the separable/inseparable and transitive/intransitive "
             "distinctions, why they are hard for learners (idiomatic meaning, multiple senses), "
             "and practical ways to teach them in groups rather than as endless lists. Your own "
             "examples. Accurate facts.")),
    Unit(uid="3.5", title="Prepositions",
         module="M3 — English Grammar for Teachers II", mode="facts",
         scope=(
             "Prepositions of time, place, and movement, plus dependent prepositions after verbs "
             "and adjectives, why they resist simple rules, and how to teach them through chunks "
             "and patterns. Original examples throughout. Standard descriptive grammar.")),
    Unit(uid="3.6", title="Functional Language and Idiom",
         module="M3 — English Grammar for Teachers II",
         **_r("functional language expressions requesting apologizing inviting suggesting "
              "everyday phrases dialogues situations idioms fixed expressions speaking",
              "Functional language: the fixed and semi-fixed expressions for doing things with "
              "language (requesting, apologizing, inviting, agreeing) and an introduction to "
              "idiom. Why functions matter alongside grammar, and how to teach them from "
              "situations. The Dialogs source is useful here.",
              references=(_SD_ACTIVITIES.format(t="*Dialogs for Everyday Use*"), _REF_COMPANION))),
    # --- M4 Teaching Methods ---
    Unit(uid="4.1", title="The Communicative Approach and Its Rivals: A Short, Honest History",
         module="M4 — Teaching Methods",
         **_r("communicative language teaching methods approaches grammar translation audiolingual "
              "history of teaching methods meaning communication classroom",
              "A brief honest history of method: grammar-translation, audiolingual, the "
              "communicative turn, and where the field landed (principled eclecticism). Use Gregg "
              "(1984) for the honest note that grand theories outran their evidence. Engaging, not "
              "a textbook timeline; no triumphalism about any one method.",
              citation_facts=GREGG_FACT, references=(_REF_GREGG, _REF_COMPANION))),
    Unit(uid="4.3", title="PPP and Test-Teach-Test",
         module="M4 — Teaching Methods",
         **_r("presentation practice production lesson framework controlled freer practice "
              "test teach test eliciting what students know teaching stages",
              "Two workhorse lesson frameworks: Presentation-Practice-Production and "
              "Test-Teach-Test. The stages of each, when each fits, and a worked mini-example. "
              "Practical staging a new teacher can copy.")),
    Unit(uid="4.4", title="Task-Based Language Teaching: What the Evidence Says",
         module="M4 — Teaching Methods",
         **_r("task based learning meaningful tasks real outcomes communication problem solving "
              "students using language to achieve goals project",
              "Task-based language teaching: what a 'task' is (a real outcome, not a grammar "
              "exercise), how a TBLT lesson runs, and the HONEST evidence. Teach the tighter g = "
              "0.61 from Xuan et al. (2025) as the headline effect; present Bryfonski & McKay's "
              "d = 0.93 as the disputed original. Direction solid, magnitude contested.",
              citation_facts=TBLT_FACTS, references=(_REF_BM, _REF_XUAN, _REF_COMPANION))),
    # --- M5 Vocabulary ---
    Unit(uid="5.1", title="How Vocabulary Is Learned: Retrieval Beats Re-Reading",
         module="M5 — Vocabulary",
         **_r("vocabulary learning words memory recall practice testing remembering new words "
              "review flashcards retrieval",
              "How vocabulary actually sticks. Use Karpicke & Roediger (2008): retrieving a word "
              "(testing) drives long-term recall, while re-reading it after one correct recall "
              "does almost nothing. What this means concretely for how a teacher recycles "
              "vocabulary. Build the unit around testing/recall, not re-presentation.",
              citation_facts=RETRIEVAL_FACTS, references=(_REF_KR, _REF_COMPANION))),
    Unit(uid="5.2", title="Spacing and Review Schedules",
         module="M5 — Vocabulary",
         **_r("spaced practice review schedule spacing repetition over time forgetting curve "
              "vocabulary recycling intervals when to review",
              "Spaced review: why spreading practice over time beats massing it, and how to build "
              "review into a course. Use Nakata (2015) and Kim & Webb (2022). Give a practical "
              "spacing routine a teacher can run without software.",
              citation_facts=SPACING_FACTS, references=(_REF_NAKATA, _REF_KW, _REF_COMPANION))),
    Unit(uid="5.3", title="Teaching Techniques and Vocabulary Activities",
         module="M5 — Vocabulary",
         **_r("vocabulary activities games presenting new words meaning context pictures word "
              "families collocation teaching techniques practice",
              "A practical kit of vocabulary techniques: presenting meaning (context, pictures, "
              "realia), organizing words (families, collocation, topic sets), and active practice "
              "and games. Draw on the Activate games and Create-to-Communicate activity banks.",
              references=(_SD_ACTIVITIES.format(t="*Activate: Games for Learning American "
                          "English*"), _SD_ACTIVITIES.format(t="*Create to Communicate*"),
                          _REF_COMPANION))),
    # --- M6 Phonology (facts) ---
    Unit(uid="6.1", title="The Sounds of English: Phonological Awareness",
         module="M6 — Phonology and Pronunciation", mode="facts",
         scope=(
             "Build the teacher's awareness of English sound: consonants and vowels, voiced vs "
             "voiceless, the gap between spelling and sound, and why phonological awareness "
             "matters for teaching. Describe sounds in plain terms with example words. Standard "
             "phonetics facts; your own examples.")),
    Unit(uid="6.2", title="The Phonemic Chart",
         module="M6 — Phonology and Pronunciation", mode="facts",
         scope=(
             "Introduce the IPA phonemic chart for English: what the symbols represent, the value "
             "of a one-symbol-one-sound system for teaching pronunciation, and how a teacher uses "
             "the chart in class. Refer to the IPA chart (CC BY-SA, in the course's resources) "
             "rather than reproducing it. Example words for key symbols; accurate phonetics."),
         references=(
             "International Phonetic Association. *IPA Chart* (CC BY-SA 4.0) — referenced, used "
             "under license in course materials.",
         )),
    Unit(uid="6.3", title="Stress, Rhythm, and Intonation",
         module="M6 — Phonology and Pronunciation", mode="facts",
         scope=(
             "The music of English: word stress, sentence stress and rhythm (stress-timing), and "
             "intonation patterns and what they signal. Why these 'suprasegmentals' often matter "
             "more for being understood than individual sounds. Plain examples written out; "
             "standard facts.")),
    Unit(uid="6.4", title="Teaching Pronunciation",
         module="M6 — Phonology and Pronunciation",
         **_r("teaching pronunciation practice drilling minimal pairs sounds intelligibility "
              "correcting pronunciation listening discrimination activities",
              "Turning phonology into teaching: intelligibility as the goal (not accent "
              "elimination), techniques (minimal pairs, drilling, listen-and-discriminate), and "
              "integrating pronunciation into normal lessons. Practical and encouraging.")),
    # --- M7 Receptive Skills ---
    Unit(uid="7.1", title="Teaching Listening",
         module="M7 — Receptive Skills",
         **_r("teaching listening comprehension pre-listening while-listening tasks audio "
              "gist detail prediction authentic listening skills practice",
              "Listening as a taught skill: pre/while/post-listening staging, listening for gist "
              "vs detail, supporting learners before they panic, and using audio well. Concrete "
              "task sequences.")),
    Unit(uid="7.3", title="Extensive Reading: The Evidence",
         module="M7 — Receptive Skills",
         **_r("extensive reading graded readers reading for pleasure amount of reading fluency "
              "free voluntary reading independent reading proficiency",
              "Extensive reading: lots of easy, self-chosen reading, and the evidence it works. "
              "Use Nakanishi (2015) and Jeon & Day (2016), keeping their effect sizes separate, "
              "with Hamada's (2020) selection-bias caveat. How to set up an extensive reading "
              "programme. Honest effect sizes.",
              citation_facts=EXTENSIVE_READING_FACTS,
              references=(_REF_NAKANISHI, _REF_JEON, _REF_COMPANION))),
    # --- M8 Productive Skills ---
    Unit(uid="8.1", title="Teaching Speaking",
         module="M8 — Productive Skills",
         **_r("teaching speaking fluency accuracy communication activities role play discussion "
              "information gap speaking practice getting students to talk confidence",
              "Getting learners talking: fluency vs accuracy activities, information-gap and "
              "role-play tasks, managing speaking time, and lowering the affective barrier. "
              "Concrete activities; light touch on error correction (that is M9).")),
    Unit(uid="8.3", title="Teaching Writing I: From Sentence to Paragraph",
         module="M8 — Productive Skills",
         **_r("teaching writing sentences paragraphs topic sentence structure controlled writing "
              "guided writing building from words to sentences to paragraphs",
              "Writing from the ground up: word to sentence to paragraph, controlled and guided "
              "writing, topic sentences and basic organization. A real writing unit, not a token "
              "one (the benchmark flagged writing as under-taught). Practical scaffolds.")),
    Unit(uid="8.4", title="Teaching Writing II: Process Writing and Correction Codes",
         module="M8 — Productive Skills",
         **_r("process writing drafting revising editing feedback on writing correction codes "
              "responding to student writing peer review redrafting",
              "Writing as a process: planning, drafting, revising, editing; responding to writing "
              "without drowning it in red ink; correction codes and peer review. Builds on 8.3.")),
    # --- M10 Lesson Planning & Materials ---
    Unit(uid="10.1", title="Lesson Aims",
         module="M10 — Lesson Planning and Materials",
         **_r("lesson aims objectives what students will be able to do learning outcomes clear "
              "goals measurable aims planning purpose of a lesson",
              "Writing clear lesson aims: outcome-focused ('learners will be able to...'), "
              "realistic in scope, and the difference between an aim and an activity. Worked "
              "examples of weak vs strong aims.")),
    Unit(uid="10.2", title="Components of a Lesson Plan",
         module="M10 — Lesson Planning and Materials",
         **_r("lesson plan stages timing materials anticipated problems procedure warm up "
              "presentation practice production components of planning",
              "The anatomy of a lesson plan: aims, stages and timing, materials, anticipated "
              "problems and solutions, and procedure. What each part is for. A annotated skeleton "
              "plan.")),
    Unit(uid="10.3", title="Planning a Lesson, Start to Finish",
         module="M10 — Lesson Planning and Materials",
         **_r("planning a lesson example worked plan choosing activities sequencing stages "
              "warm up main task wrap up timing realistic lesson",
              "A full worked example: take one teaching point and build a complete, realistic "
              "lesson from aim to wrap-up, narrating the choices. The applied counterpart to 10.1 "
              "and 10.2.")),
    Unit(uid="10.4", title="Coursebooks: Choosing, Using, and Adapting",
         module="M10 — Lesson Planning and Materials", mode="facts",
         scope=(
             "How teachers work with published coursebooks: how to evaluate one, how to use it "
             "without being a slave to it, and how to adapt, supplement, and skip. Standard ELT "
             "practice; write about coursebooks in general terms with your own hypothetical "
             "examples. Do NOT quote or reproduce any specific copyrighted coursebook's content.")),
    Unit(uid="10.5", title="Supplementary and Self-Made Materials, Teaching Aids",
         module="M10 — Lesson Planning and Materials",
         **_r("supplementary materials self-made teaching aids flashcards realia visuals "
              "worksheets making your own materials low cost classroom resources crafts",
              "Going beyond the coursebook: making flashcards, worksheets, visuals and realia, and "
              "using simple aids well. The Create-to-Communicate art-activities bank is a rich "
              "source. Practical, low-cost, do-it-yourself.",
              references=(_SD_ACTIVITIES.format(t="*Create to Communicate*"), _REF_COMPANION))),
    Unit(uid="10.6", title="Teaching with Limited Resources",
         module="M10 — Lesson Planning and Materials",
         **_r("teaching with limited resources no technology large classes few materials "
              "improvising blackboard chalk minimal equipment low resource classroom creativity",
              "Teaching well with almost nothing: a board, the students themselves, and "
              "improvised materials. Activities that need no technology or budget, turning "
              "constraints into routines. Encouraging and concrete for under-resourced settings.")),
    # --- M11 Classroom Management ---
    Unit(uid="11.2", title="Behaviour and Discipline",
         module="M11 — Classroom Management",
         **_r("classroom behaviour discipline rules routines managing disruption attention "
              "engagement preventing problems positive classroom environment",
              "Managing behaviour: prevention through routines and engagement, clear and fair "
              "expectations, and calm responses to disruption. Positive and practical, not "
              "punitive. Works across age groups with noted differences.")),
    Unit(uid="11.3", title="Teacher Roles",
         module="M11 — Classroom Management",
         **_r("teacher roles controller facilitator monitor prompter resource organizer shifting "
              "roles during a lesson when to step back student centered",
              "The roles a teacher plays (controller, organizer, monitor, prompter, facilitator, "
              "resource) and when to switch between them, especially knowing when to step back so "
              "students do the work. Concrete moments illustrating each role.")),
    Unit(uid="11.4", title="Classroom Language and Giving Instructions",
         module="M11 — Classroom Management",
         **_r("classroom language giving instructions clear simple checking understanding "
              "instruction checking questions teacher talk grading language demonstrating",
              "The language the teacher uses to run the room: giving short clear instructions, "
              "grading your own language, demonstrating rather than explaining, and checking "
              "instructions were understood. Before/after examples of muddled vs clean "
              "instructions.")),
    Unit(uid="11.5", title="Culture and Its Implications",
         module="M11 — Classroom Management",
         **_r("culture cross-cultural classroom expectations differences teaching abroad "
              "cultural sensitivity learner expectations norms adapting to context",
              "Teaching across cultures: how classroom expectations, participation norms, and "
              "attitudes to authority and error vary, and how a teacher adapts respectfully "
              "without stereotyping. Grounded, humble, practical for someone teaching abroad.")),
    # --- M12 Knowing Your Learners ---
    Unit(uid="12.2", title="The Learning-Styles Myth (and What to Do Instead)",
         module="M12 — Knowing Your Learners",
         **_r("learning styles visual auditory kinesthetic preferences myth variety multisensory "
              "individual differences matching instruction evidence",
              "Tackle the learning-styles myth head on. Use Pashler et al. (2009) and Willingham "
              "et al. (2015): matching instruction to a diagnosed 'style' lacks evidence. The "
              "evidence-supported response is VARIETY of activity formats, which serves everyone. "
              "Respectful of why the idea is popular, clear that it is debunked. This unit is the "
              "course's honesty differentiator.",
              citation_facts=LEARNING_STYLES_FACTS,
              references=(_REF_PASHLER, _REF_WILLINGHAM, _REF_COMPANION))),
    Unit(uid="12.4", title="Motivation",
         module="M12 — Knowing Your Learners",
         **_r("motivation learners engagement interest intrinsic extrinsic keeping students "
              "motivated relevance success confidence reasons for learning",
              "Learner motivation: intrinsic vs extrinsic, what teachers can actually influence "
              "(relevance, achievable challenge, success, autonomy), and practical moves that keep "
              "a class engaged. Realistic, not cheerleading.")),
    # --- M13 Assessment & Testing ---
    Unit(uid="13.1", title="Choosing Assessment Tasks",
         module="M13 — Assessment and Testing",
         **_r("assessment tasks testing what to assess validity matching test to objectives "
              "formative summative choosing how to test skills",
              "Choosing how to assess: matching the task to what was taught, formative vs "
              "summative purposes, and validity in plain terms (does the task measure what you "
              "claim). Practical task-selection guidance.")),
    Unit(uid="13.3", title="Writing Good Tests (and Why Testing Teaches)",
         module="M13 — Assessment and Testing",
         **_r("writing test items multiple choice gap fill clear instructions fair tests "
              "marking scoring reliability good test questions assessment design",
              "Writing fair, clear test items (multiple choice, gap-fill, short answer), simple "
              "marking, and the double benefit that testing itself drives learning. Use Karpicke "
              "& Roediger (2008) for the testing-effect point. Concrete do/don't item examples.",
              citation_facts=RETRIEVAL_FACTS, references=(_REF_KR, _REF_COMPANION))),
    # --- M14 Specializations ---
    Unit(uid="14.2", title="Business English and One-to-One Teaching",
         module="M14 — Specializations and the Working Teacher", mode="facts",
         scope=(
             "Two common specializations a new teacher meets: Business English (needs analysis, "
             "professional contexts, adult learners with goals) and one-to-one teaching (how it "
             "differs from group teaching, pacing, rapport, tailoring). Standard ELT practice; "
             "your own hypothetical examples; no copyrighted business-coursebook content.")),
]

UNITS: dict[str, Unit] = {
    u.uid: u
    for u in [
        *_WAVE23,
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
