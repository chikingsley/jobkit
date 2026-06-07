"""SeriousTeachers (seriousteachers.com) adapter — server-rendered TEFL/ESL board, bs4-parsed.

There is no official export/API/RSS: ``/robots.txt`` carries only Cloudflare content
signals and no sitemap directive, and ``/sitemap.xml`` and ``/rss`` return 403. Listings are
enumerated from HTML.

Browse structure (all GET, jQuery only, no SPA):
  - Global subject pages ``/0/0/<subjectId>`` (subjects 1..14) — newest per subject, capped ~10.
  - Country pages ``/0/<countryId>`` — capped ~10; the country list comes from the homepage
    "Jobs by Country" ``<select>`` (36 countries that currently have jobs).
  - Country x subject pages ``/0/<countryId>/<subjectId>`` reveal the rest (e.g. China shows 10
    on the bare country page but ~40 across its 14 subject sub-pages).
  - Detail pages ``/job_details/<jobId>/0/<slug>``.

There is no pagination ("Next"/"Previous" are carousel controls), so every list page is capped
at ~10 postings. The ONLY way to enumerate the complete live set is the country x subject cross
(36 x 14 = 504 list requests) plus one detail fetch per unique job. ``fetch_listings`` therefore
returns the newest/featured subset cheaply; ``fetch_all`` does the bounded full crawl.

Applications are gated behind a login form (``/te2/login/<jobId>/<employerId>``); employer emails
are Cloudflare-obfuscated and not exposed, so ``apply_email`` is left blank and the apply URL is
stored in ``fields["apply_url"]`` instead.

With teacher-account credentials (``SERIOUSTEACHERS_EMAIL``/``SERIOUSTEACHERS_PASSWORD``, from the
environment or the repo ``.env``), the login is a plain ASP.NET form POST — no browser needed —
and each gated apply link resolves server-side to its real destination: usually the on-site
respond form (``/te2/respond/<jobId>/<employerId>``), occasionally an external employer site.
``_collect`` resolves these automatically when credentials are present.
"""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.error
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag

from jobkit.jobs.http import USER_AGENT, fetch
from jobkit.jobs.models import JobPosting

BOARD = "seriousteachers"
BASE = "https://www.seriousteachers.com"

JOB_ID_RE = re.compile(r"/job_details/(\d+)")
APPLY_RE = re.compile(r"/te2/login/(\d+)/(\d+)", re.IGNORECASE)

# Subject category ids exposed in the top nav (1..14); used for the broad crawl.
SUBJECT_IDS = tuple(range(1, 15))

DEFAULT_LIMIT = 15
DEFAULT_MAX_PAGES = 50
DESCRIPTION_MAX = 1200
MAX_FIELD_LABEL_LEN = 40
SLEEP_SECONDS = 1.0

LOGIN_URL = f"{BASE}/te2/login"
ENV_EMAIL = "SERIOUSTEACHERS_EMAIL"
ENV_PASSWORD = "SERIOUSTEACHERS_PASSWORD"  # noqa: S105

# Repo root (this file sits at src/jobkit/jobs/boards/) — keeps the .env lookup
# independent of the directory fetch-jobs is launched from.
_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


def _credentials() -> tuple[str, str] | None:
    """Teacher-account credentials from the environment, falling back to the repo ``.env``."""
    env = dict(os.environ)
    if (ENV_EMAIL not in env or ENV_PASSWORD not in env) and _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep:
                env.setdefault(key.strip(), value.strip())
    email, password = env.get(ENV_EMAIL), env.get(ENV_PASSWORD)
    return (email, password) if email and password else None


def _post_login(client: httpx.Client, email: str, password: str) -> None:
    """POST the login form on ``client``; raise ``RuntimeError`` when it is rejected."""
    soup = BeautifulSoup(client.get(LOGIN_URL).text, "html.parser")
    token = soup.find("input", attrs={"name": "__RequestVerificationToken"})
    token_value = _attr(token, "value") if isinstance(token, Tag) else ""
    if not token_value:
        msg = "seriousteachers login page had no __RequestVerificationToken"
        raise RuntimeError(msg)
    response = client.post(
        LOGIN_URL,
        data={
            "email": email,
            "password": password,
            "idjob": "0",
            "idemployer": "0",
            "__RequestVerificationToken": token_value,
        },
    )
    if response.status_code != HTTPStatus.FOUND:
        msg = (
            f"seriousteachers login failed (HTTP {response.status_code}) — "
            f"check {ENV_EMAIL}/{ENV_PASSWORD}"
        )
        raise RuntimeError(msg)


def login() -> httpx.Client | None:
    """Return a logged-in session, or ``None`` when no credentials are configured.

    Plain ASP.NET form POST: GET the login page for the antiforgery token + cookie,
    then POST credentials; success is a 302 to the teacher panel.
    """
    creds = _credentials()
    if creds is None:
        return None
    client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
    try:
        _post_login(client, *creds)
    except BaseException:
        client.close()
        raise
    return client


def resolve_apply(client: httpx.Client, apply_url: str) -> str:
    """Follow a gated apply link with a logged-in session to its real destination."""
    response = client.get(apply_url, follow_redirects=True)
    response.raise_for_status()
    final = str(response.url)
    if "/te2/login" in final.lower():
        msg = f"apply link bounced back to login (session not accepted): {apply_url}"
        raise RuntimeError(msg)
    return final


def _warn(message: str) -> None:
    """Non-fatal adapter diagnostics to stderr (stdout is reserved for CLI output)."""
    sys.stderr.write(f"seriousteachers: {message}\n")


def _fetch_page(url: str) -> str:
    """``fetch`` that tolerates dead pages during crawls: warn and return "" instead of raising.

    Some country x subject list pages and stale detail pages 404; a single dead page
    must not abort a ~500-request crawl.
    """
    try:
        return fetch(url)
    except urllib.error.URLError as exc:
        _warn(f"skipping {url} ({exc})")
        return ""


def _attr(tag: Tag, name: str) -> str:
    """Return a tag attribute coerced to a plain ``str``."""
    value = tag.get(name)
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return " ".join(value)


def _list_url(country_id: int = 0, subject_id: int = 0) -> str:
    return f"{BASE}/0/{country_id}/{subject_id}"


def _country_ids(home_html: str) -> list[int]:
    """Country ids that currently have jobs, from the homepage 'Jobs by Country' select."""
    soup = BeautifulSoup(home_html, "html.parser")
    ids: list[int] = []
    for opt in soup.select("option"):
        value = _attr(opt, "value").strip()
        name = opt.get_text(" ", strip=True)
        if value.isdigit() and int(value) > 0 and "List all" not in name:
            ids.append(int(value))
    return list(dict.fromkeys(ids))


def _job_ids(html: str) -> list[str]:
    """Return unique job ids in document order from a list or landing page."""
    return list(dict.fromkeys(JOB_ID_RE.findall(html)))


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _label_value(label: Tag) -> str:
    """Text following a ``<b>``/``<strong>`` label up to the next such label."""
    parts: list[str] = []
    for sib in label.next_siblings:
        if isinstance(sib, Tag) and sib.name in ("b", "strong", "br"):
            break
        text = sib.get_text(" ", strip=True) if isinstance(sib, Tag) else str(sib).strip()
        if text:
            parts.append(text)
    return _clean(" ".join(parts))


def _parse_body(body: Tag, fields: dict[str, str]) -> None:
    for label in body.select("b, strong"):
        name = _clean(label.get_text(" ", strip=True)).rstrip(":").strip()
        if not name or len(name) > MAX_FIELD_LABEL_LEN:
            continue
        value = _label_value(label)
        if value:
            fields.setdefault(name, value)
    full = _clean(body.get_text(" ", strip=True))
    if full:
        fields["raw"] = full
        fields["description"] = full[:DESCRIPTION_MAX]


def _apply_url(col: Tag, job_id: str, fields: dict[str, str]) -> None:
    for anchor in col.select("a[href]"):
        href = _attr(anchor, "href")
        match = APPLY_RE.search(href)
        if match and match.group(1) == job_id:
            fields["apply_url"] = urljoin(BASE, href)
            fields["employer_id"] = match.group(2)
            return


def _parse_detail(job_id: str, html: str) -> JobPosting:
    soup = BeautifulSoup(html, "html.parser")
    col = soup.select_one("main.container-fluid div.col-sm-8") or soup

    h1 = col.select_one("h1")
    title = _clean(h1.get_text(" ", strip=True)) if h1 else ""
    if not title and soup.title:
        title = _clean(soup.title.get_text(" ", strip=True).split("|")[0])

    location = ""
    h5 = h1.find_next("h5") if h1 else None
    if h5:
        location = _clean(h5.get_text(" ", strip=True)).strip("()")

    fields: dict[str, str] = {}
    body = col.select_one("div.text-start.text-break")
    if body:
        _parse_body(body, fields)

    if not fields.get("description"):
        meta = soup.find("meta", attrs={"name": "description"})
        if isinstance(meta, Tag):
            content = _attr(meta, "content")
            if content:
                fields["description"] = _clean(content)[:DESCRIPTION_MAX]

    if location:
        country = location.split(",")[0].strip()
        if country:
            fields["country"] = country

    _apply_url(col, job_id, fields)

    return JobPosting(
        board=BOARD,
        job_id=job_id,
        url=f"{BASE}/job_details/{job_id}/0/",
        title=title,
        location=location,
        apply_email="",
        fields=fields,
    )


def _collect(job_ids: list[str], limit: int) -> list[JobPosting]:
    postings = []
    for index, job_id in enumerate(job_ids[:limit]):
        if index:
            time.sleep(SLEEP_SECONDS)
        html = _fetch_page(f"{BASE}/job_details/{job_id}/0/")
        if html:
            postings.append(_parse_detail(job_id, html))
    try:
        client = login()
    except (RuntimeError, httpx.HTTPError) as exc:
        # Apply-link resolution is optional enrichment — never break the public fetch.
        _warn(f"skipping apply-link resolution ({exc})")
        return postings
    if client is None:
        return postings
    try:
        for posting in postings:
            gated = posting.fields.get("apply_url", "")
            if not APPLY_RE.search(gated):
                continue
            time.sleep(SLEEP_SECONDS)
            try:
                posting.fields["apply_url"] = resolve_apply(client, gated)
            except (RuntimeError, httpx.HTTPError) as exc:
                _warn(f"could not resolve {gated} ({exc})")
    finally:
        client.close()
    return postings


def fetch_listings(limit: int = DEFAULT_LIMIT) -> list[JobPosting]:
    """Fetch up to ``limit`` of the newest/featured SeriousTeachers postings.

    Cheaply seeds from the homepage, then tops up from the global subject pages
    (``/0/0/<subjectId>``) until ``limit`` unique jobs are gathered. One detail fetch per job.
    """
    ids = _job_ids(fetch(BASE))
    subject_id = 0
    while len(ids) < limit and subject_id < len(SUBJECT_IDS):
        more = _job_ids(fetch(_list_url(subject_id=SUBJECT_IDS[subject_id])))
        ids.extend(jid for jid in more if jid not in ids)
        subject_id += 1
    return _collect(ids, limit)


def fetch_all(max_pages: int = DEFAULT_MAX_PAGES, limit: int | None = None) -> list[JobPosting]:
    """Crawl the country x subject cross to enumerate the broad live set (bounded).

    Visits at most ``max_pages`` list pages: each country's bare page first, then its subject
    sub-pages, collecting every unique ``/job_details`` id, then fetches one detail page per job
    (capped at ``limit`` if given). A complete crawl is ~504 list pages plus the detail fetches;
    raise ``max_pages``/leave ``limit`` unset for the full set.
    """
    home = fetch(BASE)
    ids: list[str] = _job_ids(home)
    pages_used = 0
    for country_id in _country_ids(home):
        if pages_used >= max_pages:
            break
        time.sleep(SLEEP_SECONDS)
        ids.extend(jid for jid in _job_ids(_fetch_page(_list_url(country_id))) if jid not in ids)
        pages_used += 1
        for subject_id in SUBJECT_IDS:
            if pages_used >= max_pages:
                break
            time.sleep(SLEEP_SECONDS)
            more = _job_ids(_fetch_page(_list_url(country_id, subject_id)))
            ids.extend(jid for jid in more if jid not in ids)
            pages_used += 1
    return _collect(ids, len(ids) if limit is None else limit)
