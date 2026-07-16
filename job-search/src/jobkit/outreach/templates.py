"""Base outreach template, signature, and the default open-ended questions.

These bake in Ben's outreach rules from `docs/job-search-playbook.md`: lead with what the candidate
offers, keep it short, always include at least one open-ended question that requires a reply, and
sign as Chibuzor (the `chibuzor.ejimofor@gmail.com` account used for this whole job search). The
signature mirrors `templates/email-templates.md`. `compose.py` uses these for the no-LLM fallback
and to enforce the question + signature on any LLM-written body.
"""

from __future__ import annotations

import re

# The account every outreach email is sent from / signed by (see playbook).
SENDER_EMAIL = "chibuzor.ejimofor@gmail.com"
SENDER_NAME = "Chibuzor Ejimofor"

# Plain-text signature, matching the "Best, Chibuzor Ejimofor" close in email-templates.md.
SIGNATURE = f"Best,\n{SENDER_NAME}"

# One bold summary line of what the candidate offers — Ben's "lead with what you offer" rule.
OFFER_LINE = (
    "I am a TEFL-certified professional educator with a Bachelor's degree and an American "
    "passport, available to start immediately."
)

# Live contact handle for the signature/follow-up. The review notes interviews were almost always
# booked over Skype/WhatsApp/Zoom, and the 2019 batch carried `cheez20` on Skype — so we offer a
# live channel and (in follow-ups) a specific call window.
CONTACT_CHANNEL = "Skype: cheez20 (or WhatsApp on request)"

# Open-ended questions that require a reply. The composer ensures at least one of these (or an
# LLM-written equivalent) is present — a reply confirms the address is live and the message landed.
DEFAULT_QUESTIONS: tuple[str, ...] = (
    "Is your school still currently seeking an English teacher for the upcoming term?",
    "Could you tell me a little more about the role and the students I would be teaching?",
    "Would it be possible to learn more about the contract terms and start date?",
)

# A light cue set used to detect whether a body already contains a genuine question. A trailing
# question mark plus one of these openers is a good-enough signal without over-engineering NLP.
_QUESTION_CUES: tuple[str, ...] = (
    "is ",
    "are ",
    "do ",
    "does ",
    "did ",
    "could ",
    "would ",
    "can ",
    "may ",
    "what ",
    "when ",
    "where ",
    "who ",
    "how ",
    "which ",
)


# Third-person tells. The model once wrote "on behalf of Chibuzor ..." — a cold email must be in
# the candidate's own first-person voice, so any of these phrasings disqualifies an LLM body
# (compose degrades to the template) and hard-fails validation. The signature ("Best,\nChibuzor
# Ejimofor") contains none of these patterns.
_THIRD_PERSON_RE = re.compile(
    r"\bon behalf of\b"
    r"|\bchibuzor (?:is|has|was|will|would|holds|offers)\b"
    r"|\b(?:he|she) (?:is|has|was|will|would|holds|offers)\b"
    r"|\bhis\b|\bhers\b",
    re.IGNORECASE,
)


def looks_third_person(body: str) -> bool:
    """Return True if `body` refers to the candidate in the third person (not his own voice)."""
    return bool(_THIRD_PERSON_RE.search(body))


def has_open_ended_question(body: str) -> bool:
    """Return True if `body` plausibly contains an open-ended question that needs a reply.

    Heuristic, not a parser: split into '?'-terminated segments (so a question mid-paragraph
    counts, not just one on its own line) and accept any segment that contains an interrogative
    cue word — which rules out rhetorical fragments while catching "...Is your school still ...?".
    """
    for segment in re.findall(r"[^.?!\n]*\?", body):
        lowered = segment.lower()
        if any(re.search(rf"\b{cue.strip()}\b", lowered) for cue in _QUESTION_CUES):
            return True
    return False


def default_question(country: str = "") -> str:
    """Return a sensible default open-ended question, lightly tailored by country if given."""
    if country:
        return f"Is your school in {country} still currently seeking an English teacher?"
    return DEFAULT_QUESTIONS[0]


# The fixed role label leading every subject. The 2019 reference email used
# "Native English Teacher Available - {location}". Ben saw that email but did not explicitly
# prescribe or validate the subject; this is a current product convention with historical
# provenance, not a measured universal optimum.
_SUBJECT_ROLE = "Native English Teacher"


def subject_line(*, role: str = "", location: str = "") -> str:
    """Build the subject `"Native English Teacher Available - {location}"` (a 2019 user pattern).

    `role` adapts the label when the posting is for a specific discipline (e.g. a chemistry
    position becomes "Native English-Speaking Chemistry Teacher"); a plain English-teaching role
    keeps the standard label. The location anchor is appended when known. Never emits a bare
    generic "English Teacher".
    """
    label = _role_label(role)
    where = location.strip()
    if where:
        return f"{label} Available - {where}"
    return f"{label} Available"


def _role_label(role: str) -> str:
    """Map a posting's role title to the subject's lead label (default: the standard label)."""
    text = role.strip()
    lowered = text.lower()
    if not text or "english" in lowered or "esl" in lowered or "tefl" in lowered:
        return _SUBJECT_ROLE
    # A non-English discipline (Chemistry Teacher, Math Teacher, ...): keep the native-speaker
    # signal while naming the actual role.
    return f"Native English-Speaking {text}"


def fallback_body(*, title: str, company: str, country: str) -> str:
    """Build the pure-template outreach body (used when no LLM is available).

    Always includes the offer line, a default open-ended question, and the signature, so the
    fallback already satisfies the rules `compose.py` enforces.
    """
    role = title.strip() or "English teaching position"
    where = f" in {country.strip()}" if country.strip() else ""
    school = company.strip() or "your school"
    greeting = "Hello,"
    intro = (
        f"My name is {SENDER_NAME}, and I am writing about the {role}{where} at {school}. "
        f"{OFFER_LINE}"
    )
    interest = (
        "I would welcome the opportunity to contribute as an English teacher and to support "
        "your students' progress."
    )
    question = default_question(country)
    return f"{greeting}\n\n{intro}\n\n{interest}\n\n{question}\n\n{SIGNATURE}"


def followup_body(n: int, *, school: str = "", country: str = "") -> str:
    """Build a short, polite follow-up nudge body for the 1st (n=1) or 2nd (n=2) follow-up.

    References the prior note, re-asks an open-ended question (Ben's rule #1, the single
    most under-applied piece of his advice), offers a specific call window, and surfaces a live
    contact channel (Skype/WhatsApp) — the channels the review found interviews were booked over.
    Always ends with the signature. Guaranteed to satisfy `has_open_ended_question`.
    """
    where = f" in {country.strip()}" if country.strip() else ""
    school_phrase = school.strip() or "your school"
    greeting = "Hello,"
    if n <= 1:
        opener = (
            f"I wanted to gently follow up on my note about teaching English at {school_phrase}"
            f"{where} — I know inboxes get busy this time of year."
        )
    else:
        opener = (
            f"Following up once more on my note about the English teaching role at "
            f"{school_phrase}{where}; I remain very interested and available to start soon."
        )
    question = default_question(country)
    window = (
        "Would you be free for a short call this week or next — for example, "
        "weekday mornings your time? "
        f"You can also reach me on {CONTACT_CHANNEL}."
    )
    return f"{greeting}\n\n{opener}\n\n{question}\n\n{window}\n\n{SIGNATURE}"
