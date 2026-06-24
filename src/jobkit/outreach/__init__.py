"""Draft-first cold-outreach for ESL teaching jobs.

This package composes tailored cold-outreach emails from the normalized job rows produced by
`jobkit.jobs.enrich` and stages them as Gmail **drafts** in the user's mailbox. It is draft-only
by construction: the single mailbox write it performs is `users.drafts.create` (see
`jobkit.outreach.draft`). There is deliberately no code path that calls `messages.send` or
`drafts.send`, so this module can never send mail — a human reviews and sends every draft.

The outreach rules are Ben's (see `docs/job-search-playbook.md`): lead with what the candidate
offers, keep it short and professional, ALWAYS include at least one open-ended question that
requires a reply, and sign as Chibuzor. `compose.compose_outreach` enforces the question +
signature in code even when an LLM writes the body, and falls back to a pure template fill when no
LLM is available.
"""

from __future__ import annotations

from jobkit.outreach.compose import compose_outreach
from jobkit.outreach.draft import create_draft, create_reply_draft
from jobkit.outreach.validate import validate_email

__all__ = ["compose_outreach", "create_draft", "create_reply_draft", "validate_email"]
