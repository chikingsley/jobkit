"""Compose one tailored cold-outreach email from a normalized job row.

`compose_outreach` takes a single normalized job dict from a job-board export and
returns `{"subject": ..., "body": ...}`. It asks Claude Sonnet 4.6 (via `jobkit.llm`) to personalize
the BODY to the school/role/country, but the model is never trusted to satisfy Ben's rules — they
are enforced in code:

- The SUBJECT is always built deterministically (`templates.subject_line`'s "Native English
  Teacher Available - {location}" shape — the user's proven 2019 format), never taken from the
  model — a bare generic "English Teacher" subject is impossible by construction.
- The body must be in the candidate's own FIRST-PERSON voice; a third-person body ("on behalf of
  Chibuzor ...") is discarded and the template fill is used instead.
- The body is guaranteed to contain at least one open-ended question (a sensible default is
  appended if the model omitted one) and to end with the Chibuzor signature.

When no LLM is available — no auth, no cache, network failure, or bad output — it degrades to a
pure-template fill that already meets those rules. This function never raises and never sends
anything; composing is pure text.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from jobkit.outreach import templates

if TYPE_CHECKING:
    from jobkit.llm import SuperwhisperClient

# Cap the posting description sent to the model: enough for the role/school/country flavour without
# burning tokens on boilerplate (mirrors the cap in jobkit.jobs.enrich).
_DESCRIPTION_CAP = 1500
_MAX_TOKENS = 600

# The model writes ONLY the body. The subject is built in code (`templates.subject_line`) so its
# shape is enforced by construction, not by prompt compliance.
_LLM_INSTRUCTIONS = (
    "You ARE Chibuzor Ejimofor, writing your own short, professional cold-outreach email for an "
    "ESL/English teaching job. Write entirely in the FIRST PERSON ('I am...', 'I would love "
    "to...') — never refer to yourself in the third person and never write 'on behalf of'. "
    "Rules: lead with what you offer (TEFL-certified, Bachelor's degree, American passport, "
    "available immediately), keep it to 3-5 short sentences, be warm and specific to the "
    "school/role/country, and DO NOT invent facts about the school that are not in the posting. "
    "CRITICAL: the email MUST include at least one open-ended question that requires a reply "
    "(e.g. 'Is your school still seeking an English teacher for the upcoming term?'). Do not ask "
    "them to send you anything; the goal is to start a reply thread. Return ONLY a JSON object "
    "with one string key: 'body' (the email body WITHOUT any signature and WITHOUT a subject "
    "line — both are added separately). Do not include a greeting placeholder like [Name]; use "
    "a neutral greeting."
)


def outreach_subject(job: dict[str, str]) -> str:
    """Return the deterministic subject for `job` — no LLM involved, safe to call cheaply.

    This is THE subject `compose_outreach` will use ("Native English Teacher
    Available - {location}"), so callers can de-duplicate against the mailbox before paying
    for a composed body.
    """
    return templates.subject_line(
        role=job.get("title", ""),
        location=job.get("location", "") or job.get("country", ""),
    )


def compose_outreach(
    job: dict[str, str], *, client: SuperwhisperClient | None = None
) -> dict[str, str]:
    """Compose a tailored cold-outreach email for one normalized `job` row.

    Returns `{"subject", "body"}`. The subject is always built in code from the job fields
    (deterministic credentials + availability + location shape). Uses `client` (a
    `SuperwhisperClient`) to personalize the body when one is supplied; otherwise — or on any
    LLM failure, including a third-person body — falls back to the pure template. The returned
    body is guaranteed to contain an open-ended question and to end with the signature.
    """
    title = job.get("title", "")
    company = job.get("company", "")
    country = job.get("country", "")

    subject = outreach_subject(job)
    body = _llm_compose(job, client) if client is not None else None
    if body is None:
        body = templates.fallback_body(title=title, company=company, country=country)
        return {"subject": subject, "body": body}
    return {"subject": subject, "body": _enforce_rules(body, country)}


def _llm_compose(job: dict[str, str], client: SuperwhisperClient | None) -> str | None:
    """Ask the model for a tailored body; return None on any failure or a third-person voice."""
    if client is None:
        return None
    try:
        parsed = client.generate_json(
            [{"role": "user", "content": _build_prompt(job)}],
            max_tokens=_MAX_TOKENS,
        )
    except Exception:  # noqa: BLE001 - any network/parse failure degrades to the template.
        return None
    if not isinstance(parsed, dict):
        return None
    body = _as_str(cast("dict[str, object]", parsed).get("body"))
    if not body or templates.looks_third_person(body):
        return None
    return body


def _build_prompt(job: dict[str, str]) -> str:
    """Build the LLM prompt from the posting's role/school/country/description."""
    lines = [
        _LLM_INSTRUCTIONS,
        "",
        f"Role title: {job.get('title', '')}",
        f"School / employer: {job.get('company', '')}",
        f"Country: {job.get('country', '')}",
        f"Location: {job.get('location', '')}",
        f"Posting URL: {job.get('url', '')}",
    ]
    description = job.get("description", "")
    if description:
        lines += ["", "Posting text:", description[:_DESCRIPTION_CAP]]
    lines += [
        "",
        "What you offer: " + templates.OFFER_LINE,
    ]
    return "\n".join(lines)


def _enforce_rules(body: str, country: str) -> str:
    """Guarantee Ben's rules on an LLM-written body: an open-ended question + the signature.

    A model body may already include a signature; we strip any trailing Chibuzor sign-off and a
    dangling question we are about to (re)check, then re-append exactly one signature so the output
    is consistent regardless of what the model produced.
    """
    text = _strip_signature(body).rstrip()
    if not templates.has_open_ended_question(text):
        text = f"{text}\n\n{templates.default_question(country)}"
    return f"{text}\n\n{templates.SIGNATURE}"


def _strip_signature(body: str) -> str:
    """Remove a trailing 'Best, / Chibuzor Ejimofor' style sign-off the model may have added."""
    lines = body.rstrip().splitlines()
    sign_cues = ("best", "regards", "sincerely", "kind regards", "warm regards", "thanks")
    while lines:
        last = lines[-1].strip().lower().rstrip(",.")
        if last == templates.SENDER_NAME.lower() or last in sign_cues or not last:
            lines.pop()
            continue
        break
    return "\n".join(lines)


def _as_str(value: object) -> str:
    """Coerce a model-returned JSON value to a stripped string ("" for null)."""
    if value is None:
        return ""
    return str(value).strip()
