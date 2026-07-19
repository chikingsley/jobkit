"""Normalize messy `JobPosting` records into one consistent, board-agnostic schema.

Different boards populate `JobPosting.fields` very differently (see `models.py`): ANESL is a
clean label/value table, SeriousTeachers is semi-structured, and the ESL Cafe job board is pure
free text in `fields["body"]`. This module flattens all of them into the columns listed in
`SCHEMA` so every board lines up in one table for export.

Two extractors implement the `Extractor` protocol:

- `HeuristicExtractor` (the `DEFAULT_EXTRACTOR`) is **pure and offline** — only stdlib regex and
  string heuristics, no network. Deterministic and free; used by tests and the offline demo.
- `LLMExtractor` sends each posting's free text to Claude Sonnet 4.6 (via `jobkit.llm`, the
  Superwhisper proxy) to parse the structured fields the regex misses. The posting's identity
  (board/job_id/url/title) and any apply email/URL the adapter already captured are kept
  authoritative; the model only fills the messy free-text fields. On any per-posting failure it
  falls back to the heuristic extractor, so a flaky network never breaks an export.

Neither path ever raises out of `enrich()`; missing values fall back to "". The CLI opts into
the LLM extractor for enriched output (`--csv` / `--json --enriched`, unless `--no-llm`).
"""

from __future__ import annotations

import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TYPE_CHECKING, Protocol, cast, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

    from jobkit.jobs.models import JobPosting
    from jobkit.llm import SuperwhisperClient

# Normalized output columns, in stable order. `export.to_csv` reuses this as its header row,
# so the order here is the documented, deterministic column order for every export.
SCHEMA: tuple[str, ...] = (
    "board",
    "job_id",
    "url",
    "title",
    "company",
    "location",
    "country",
    "salary",
    "currency",
    "degree_required",
    "eu_passport_required",
    "contract_length",
    "start_date",
    "apply_email",
    "apply_url",
    "posted_date",
    "description",
    "raw",
)

# --- regex / keyword tables --------------------------------------------------------------------

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s<>\")]+")

# Currency tokens mapped to a canonical code. Symbols and words both resolve here.
CURRENCY_TOKENS: dict[str, str] = {
    "rmb": "RMB",
    "cny": "RMB",
    "yuan": "RMB",
    "¥": "RMB",
    "usd": "USD",
    "us$": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "$": "USD",
    "thb": "THB",
    "baht": "THB",
    "฿": "THB",
    "krw": "KRW",
    "won": "KRW",
    "₩": "KRW",
    "eur": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "€": "EUR",
    "gbp": "GBP",
    "£": "GBP",
}

# A salary phrase: a currency token adjacent to a number (with optional range / thousands).
_NUM = r"\d[\d,\. ]*\d|\d"
_DASH = "-–"  # noqa: RUF001 - hyphen-minus and EN DASH, both seen in salary ranges.
SALARY_RE = re.compile(
    rf"(?P<sym>RMB|CNY|USD|THB|KRW|EUR|GBP|US\$|[¥$฿₩€£])\s*:?\s*"
    rf"(?P<amount>{_NUM}(?:\s*(?:[{_DASH}]|to)\s*{_NUM})?)"
    rf"|(?P<amount2>{_NUM}(?:\s*(?:[{_DASH}]|to)\s*{_NUM})?)\s*"
    rf"(?P<sym2>RMB|CNY|USD|THB|KRW|EUR|GBP|yuan|baht|won|euros?|dollars?)",
    re.IGNORECASE,
)

# Contract length, e.g. "10 months", "1 year", "1.5 years", "one year".
CONTRACT_RE = re.compile(
    r"\b(\d+(?:\.\d+)?|one|two|three)[\s-]*(year|years|month|months|semester|semesters)\b",
    re.IGNORECASE,
)

# Degree mentions, longest/most-specific first so we report the strongest signal.
DEGREE_TERMS: tuple[str, ...] = (
    "PhD",
    "Doctorate",
    "Master",
    "Bachelor",
    "Diploma",
    "CELTA",
    "TESOL",
    "TEFL",
    "TKT",
    "BA",
    "BSc",
    "BEd",
    "MA",
    "MEd",
)

# Country keywords for the free-text boards. Match is case-insensitive, word-boundary.
COUNTRY_TERMS: tuple[str, ...] = (
    "China",
    "South Korea",
    "Korea",
    "Japan",
    "Taiwan",
    "Thailand",
    "Vietnam",
    "Indonesia",
    "Saudi Arabia",
    "United Arab Emirates",
    "UAE",
    "Qatar",
    "Kuwait",
    "Oman",
    "Spain",
    "Italy",
    "Mexico",
    "Brazil",
    "Colombia",
    "Turkey",
    "Russia",
    "Tajikistan",
    "Poland",
    "Germany",
    "France",
    "Online",
)

# Postings (common for Czech Republic / EU schools) that require EU citizenship / an EU passport /
# the right to work in the EU. Rows stay in the dataset with this flag set so a non-EU candidate
# can filter them out without losing the data.
EU_REQUIRED_RE = re.compile(
    r"\bEU\s+(?:passport|citizen\w*|national\w*)"
    r"|\beuropean\s+(?:union\s+)?(?:passport|citizen\w*)"
    r"|right\s+to\s+work\s+in\s+the\s+EU",
    re.IGNORECASE,
)

# Posting date label patterns seen in free text ("Posted:" lines, etc.).
DATE_RE = re.compile(
    r"\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}"
    r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b",
)

# Structured keys that hold an actual employer NAME. ANESL's "Employer's Type" is deliberately
# NOT here: it is a category ("Public University", "Training Center"), not a company name — the
# LLM pass fills `company` from the raw text when a real name is stated.
COMPANY_KEYS = ("Company", "company", "Employer", "School")


def _first(text: str, terms: Sequence[str]) -> str:
    """Return the first term (verbatim) that appears as a whole word in `text`, else ""."""
    for term in terms:
        if re.search(rf"\b{re.escape(term)}\b", text, re.IGNORECASE):
            return term
    return ""


def _find_currency(text: str) -> str:
    """Return a canonical currency code for the first currency token in `text`, else ""."""
    lowered = text.lower()
    best_pos = len(text) + 1
    best_code = ""
    for token, code in CURRENCY_TOKENS.items():
        idx = lowered.find(token) if not token.isalpha() else _word_index(lowered, token)
        if 0 <= idx < best_pos:
            best_pos = idx
            best_code = code
    return best_code


def _word_index(lowered: str, token: str) -> int:
    """Index of `token` as a whole word in already-lowercased `lowered`, or -1."""
    match = re.search(rf"\b{re.escape(token)}\b", lowered)
    return match.start() if match else -1


def _extract_salary(text: str) -> tuple[str, str]:
    """Return (salary_phrase, currency_code) from free text, both "" if nothing matches."""
    match = SALARY_RE.search(text)
    if not match:
        return "", ""
    phrase = re.sub(r"\s+", " ", match.group(0)).strip()
    sym = match.group("sym") or match.group("sym2") or ""
    currency = CURRENCY_TOKENS.get(sym.lower(), "") if sym else _find_currency(phrase)
    return phrase, currency


def _extract_contract(text: str) -> str:
    """Return a normalized contract length phrase, e.g. "10 months", or ""."""
    match = CONTRACT_RE.search(text)
    return re.sub(r"\s+", " ", match.group(0)).strip().lower() if match else ""


@runtime_checkable
class Extractor(Protocol):
    """Turns one `JobPosting` into a normalized dict keyed by `SCHEMA`.

    Implementations must be total (every key in `SCHEMA` present, "" when unknown) and must
    never raise. `HeuristicExtractor` is the offline default; a future `LLMExtractor` can
    implement this same method by delegating free-text parsing to the Claude API.
    """

    def extract(self, posting: JobPosting) -> dict[str, str]:
        """Return a normalized dict with exactly the `SCHEMA` keys."""
        ...


class HeuristicExtractor:
    """Offline, transparent extractor: map structured fields first, regex the rest from text."""

    def extract(self, posting: JobPosting) -> dict[str, str]:
        """Normalize `posting`; always returns all `SCHEMA` keys, "" where unknown."""
        fields = posting.fields
        body = fields.get("body") or fields.get("description") or fields.get("Details") or ""
        haystack = "\n".join(filter(None, (posting.title, body)))

        salary, currency = self._salary(fields, haystack)
        result: dict[str, str] = {
            "board": posting.board,
            "job_id": posting.job_id,
            "url": posting.url,
            "title": posting.title,
            "company": self._company(fields),
            "location": posting.location or fields.get("country", ""),
            "country": self._country(posting, haystack),
            "salary": salary,
            "currency": currency,
            "degree_required": self._degree(fields, haystack),
            "eu_passport_required": "yes" if EU_REQUIRED_RE.search(haystack) else "",
            "contract_length": self._contract(fields, haystack),
            "start_date": fields.get("Start Date", "").strip(),
            "apply_email": self._apply_email(posting, haystack),
            "apply_url": self._apply_url(posting, haystack),
            "posted_date": self._posted(fields, body),
            "description": self._description(body),
            "raw": fields.get("raw") or body,
        }
        return {key: result.get(key, "") for key in SCHEMA}

    @staticmethod
    def _company(fields: dict[str, str]) -> str:
        for key in COMPANY_KEYS:
            value = fields.get(key)
            if value:
                return value.strip()
        return ""

    @staticmethod
    def _country(posting: JobPosting, haystack: str) -> str:
        explicit = posting.fields.get("country", "").strip()
        if explicit:
            return explicit
        return _first(f"{posting.location}\n{haystack}", COUNTRY_TERMS)

    @staticmethod
    def _salary(fields: dict[str, str], haystack: str) -> tuple[str, str]:
        monthly = fields.get("Salary/M")
        structured = monthly or fields.get("Salary")
        if structured:
            stripped = structured.strip()
            if stripped.lower() in {"negotiable", "competitive", "doe", "tbd"}:
                return stripped, ""
            if monthly and "month" not in stripped.lower() and "/m" not in stripped.lower():
                stripped = f"{stripped} / month"
            return stripped, _find_currency(stripped)
        return _extract_salary(haystack)

    @staticmethod
    def _degree(fields: dict[str, str], haystack: str) -> str:
        structured = fields.get("Degree") or fields.get("Required Degrees")
        if structured:
            found = _first(structured, DEGREE_TERMS)
            return found or structured.strip()
        return _first(haystack, DEGREE_TERMS)

    @staticmethod
    def _contract(fields: dict[str, str], haystack: str) -> str:
        start = fields.get("Start Date", "")
        return _extract_contract(start) or _extract_contract(haystack)

    @staticmethod
    def _apply_email(posting: JobPosting, haystack: str) -> str:
        if posting.apply_email:
            return posting.apply_email
        explicit = posting.fields.get("E-Mail", "").strip()
        if explicit:
            return explicit
        match = EMAIL_RE.search(haystack)
        return match.group(0) if match else ""

    @staticmethod
    def _apply_url(posting: JobPosting, haystack: str) -> str:
        explicit = posting.fields.get("apply_url", "").strip()
        if explicit:
            return explicit
        match = URL_RE.search(haystack)
        return match.group(0).rstrip(".,;)") if match else ""

    @staticmethod
    def _posted(fields: dict[str, str], body: str) -> str:
        explicit = fields.get("posted") or fields.get("Update")
        if explicit:
            return explicit.strip()
        match = DATE_RE.search(body)
        return match.group(0) if match else ""

    @staticmethod
    def _description(body: str) -> str:
        return re.sub(r"\s+", " ", body).strip()


# Fields the model verifies/corrects. The rest of `SCHEMA` (identity, description, apply_*) is
# filled deterministically from the posting, so the model can never drop or hallucinate them.
_LLM_FIELDS: tuple[str, ...] = (
    "company",
    "location",
    "country",
    "salary",
    "currency",
    "degree_required",
    "eu_passport_required",
    "contract_length",
    "start_date",
    "posted_date",
)

_LLM_INSTRUCTIONS = (
    "You verify and correct structured fields for a single ESL/teaching job posting. "
    "You are given the posting text plus current best-guess values (regex-derived, so some are "
    "wrong or spurious). Return ONLY a JSON object with exactly these string keys: "
    f"{', '.join(_LLM_FIELDS)}. "
    "For each key: keep the guess if the posting clearly supports it, fix it if it is wrong, and "
    "use an empty string if the posting does not actually state it (never invent a value). "
    "salary: a short phrase as written (e.g. '15000-18000', 'Negotiable'). "
    "currency: a 3-letter code (RMB, USD, THB, KRW, EUR, GBP) or '' if none. "
    "country: the country only (e.g. 'China', 'Thailand', 'Online' for remote). "
    "degree_required: the minimum degree/certificate the job REQUIRES (e.g. 'Bachelor', 'TEFL') "
    "— not degrees merely mentioned in prose. "
    "eu_passport_required: 'yes' ONLY if the posting requires EU citizenship, an EU passport, or "
    "the right to work in the EU; '' otherwise (a visa-sponsoring job is NOT 'yes'). "
    "contract_length: only an actual employment term (e.g. '12 months', '1 year'). "
    "start_date / posted_date: as written in the posting."
)


class LLMExtractor:
    """Corrects a posting's heuristic fields with Claude Sonnet 4.6 via the Superwhisper proxy.

    The heuristic extraction is the floor: `extract` starts from `HeuristicExtractor` (so adapter
    structured fields, body-found contacts, identity, and description are always present and
    authoritative), then asks the model to verify/correct only the `_LLM_FIELDS`. The model sees
    those guesses, so it keeps the good ones and blanks the spurious ones (e.g. a contract length
    regexed out of marketing prose). Any failure — missing cache, network, bad JSON — degrades to
    the pure heuristic result; after one client-construction failure the LLM is disabled for the
    rest of the run so a missing Mac cache can't trigger an rsync/timeout per posting.
    """

    def __init__(self, *, max_tokens: int = 700) -> None:
        """Configure the extractor; the network client is opened on first `extract` call."""
        self._max_tokens = max_tokens
        self._client: object | None = None
        self._disabled = False
        self._fallback = HeuristicExtractor()
        # Guards the lazy client build and the `_disabled` circuit-breaker flip so that under
        # concurrent `extract` calls the client is constructed exactly once (one rsync/timeout at
        # worst) and every worker sees a consistent breaker state.
        self._lock = threading.Lock()

    def _client_or_none(self) -> object | None:
        """Return the cached client, building it once; disable the LLM for the run on failure."""
        # Fast path: once built (or disabled) these reads are stable, so avoid taking the lock.
        if self._disabled:
            return None
        if self._client is not None:
            return self._client
        with self._lock:
            # Re-check under the lock: another thread may have won the race while we waited.
            if self._disabled:
                return None
            if self._client is None:
                # Lazy import keeps the network/auth dependency out of the import path.
                from jobkit.llm import SuperwhisperClient  # noqa: PLC0415

                try:
                    self._client = SuperwhisperClient()
                except Exception:  # noqa: BLE001 - no auth/cache: degrade the run to heuristics.
                    self._disabled = True
                    return None
            return self._client

    def extract(self, posting: JobPosting) -> dict[str, str]:
        """Return heuristic fields corrected by the model; pure heuristics on any failure."""
        base = self._fallback.extract(posting)
        client = self._client_or_none()
        if client is None:
            return base
        try:
            parsed = cast("SuperwhisperClient", client).generate_json(
                [{"role": "user", "content": _build_llm_prompt(posting, base)}],
                max_tokens=self._max_tokens,
            )
        except Exception:  # noqa: BLE001 - network/parse failure keeps the heuristic floor.
            return base
        if not isinstance(parsed, dict):
            return base
        fields = cast("dict[str, object]", parsed)
        # Trust the model for the fields it returns: a present "" means "not actually stated" (so
        # it can clear a bad guess); an absent key leaves the heuristic value untouched.
        for key in _LLM_FIELDS:
            if key in fields:
                base[key] = _as_str(fields[key])
        return base

    def close(self) -> None:
        """Close the underlying HTTP client if one was opened."""
        if self._client is not None:
            cast("SuperwhisperClient", self._client).close()
            self._client = None


def _as_str(value: object) -> str:
    """Coerce a model-returned JSON value to a stripped string ("" for null/empty)."""
    if value is None:
        return ""
    return str(value).strip()


# Cap on the posting text sent to the model: the full `raw` dump can be large, but a few thousand
# chars covers the salary/requirements/location detail without burning tokens on boilerplate.
_PROMPT_TEXT_CAP = 6000


def _build_llm_prompt(posting: JobPosting, guesses: dict[str, str]) -> str:
    """Build the prompt: instructions, the posting's text, and the current best guesses."""
    lines = [_LLM_INSTRUCTIONS, "", f"Title: {posting.title}"]
    fields = posting.fields
    text = fields.get("raw") or fields.get("body") or fields.get("description") or ""
    if text:
        lines += ["", "Posting text:", text[:_PROMPT_TEXT_CAP]]
    lines += ["", "Current best-guess values (correct these):"]
    lines += [f"{key}: {guesses.get(key, '')}" for key in _LLM_FIELDS]
    return "\n".join(lines)


# Default extractor used by `enrich`: offline heuristics, so the library stays pure and tests /
# the demo need no network. The CLI explicitly passes an `LLMExtractor()` for enriched output.
DEFAULT_EXTRACTOR: Extractor = HeuristicExtractor()


def enrich(posting: JobPosting, *, extractor: Extractor = DEFAULT_EXTRACTOR) -> dict[str, str]:
    """Normalize a single `JobPosting` to the common `SCHEMA`. Never raises."""
    try:
        return extractor.extract(posting)
    except Exception:  # noqa: BLE001 - enrichment must never fail a whole export run.
        base = dict.fromkeys(SCHEMA, "")
        base.update(
            board=posting.board,
            job_id=posting.job_id,
            url=posting.url,
            title=posting.title,
        )
        return base


# Only emit a stderr progress line once a run is big enough to be worth watching, and only every
# Nth completion, so short runs (and the offline demo) stay silent and large runs stay non-spammy.
_PROGRESS_MIN_POSTINGS = 20
_PROGRESS_EVERY = 10


def enrich_all(
    postings: Iterable[JobPosting],
    *,
    extractor: Extractor = DEFAULT_EXTRACTOR,
    max_workers: int = 8,
) -> list[dict[str, str]]:
    """Normalize many postings; see `enrich`. Returns one dict per posting, in input order.

    The per-posting `extractor.extract` work is I/O-bound for `LLMExtractor` (one HTTP POST each,
    and `httpx.Client` is thread-safe), so when `max_workers > 1` and there is more than one
    posting the calls run concurrently on a `ThreadPoolExecutor`. The offline `HeuristicExtractor`
    is CPU-only and instant; the executor's overhead is negligible there, so for simplicity the
    same threaded path is used whenever it could help. Results are written back by index, so the
    returned list is always in input order regardless of completion order. `enrich` never raises,
    so one failing worker degrades only its own posting to the heuristic floor.
    """
    items = list(postings)
    if max_workers <= 1 or len(items) <= 1:
        return [enrich(posting, extractor=extractor) for posting in items]

    results: list[dict[str, str] | None] = [None] * len(items)
    progress = len(items) >= _PROGRESS_MIN_POSTINGS
    done = 0
    workers = min(max_workers, len(items))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(enrich, posting, extractor=extractor): index
            for index, posting in enumerate(items)
        }
        for future in as_completed(futures):
            index = futures[future]
            results[index] = future.result()  # enrich never raises, so this is always a dict.
            done += 1
            if progress and (done % _PROGRESS_EVERY == 0 or done == len(items)):
                print(f"enriched {done}/{len(items)}", file=sys.stderr)  # noqa: T201
    # Every slot is filled because every future is awaited; cast away the Optional for the caller.
    return cast("list[dict[str, str]]", results)
