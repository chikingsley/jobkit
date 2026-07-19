"""TEFL.com (www.tefl.com) adapter — the largest dedicated EFL/ESL teaching board, server-rendered.

TEFL.com is a server-rendered (jQuery, no SPA) Java application. There is no usable export: the
``sitemap.xml`` is stale (2014) and not job-level, and ``robots.txt`` 404s. Listings are therefore
enumerated from the rendered HTML and each detail page carries a clean ``application/ld+json``
``JobPosting`` block that we treat as the authoritative source for the structured fields.

Browse structure (all plain GET; no session cookie is required — a JSESSIONID is set but the
public reads work fine without carrying it, so the shared :func:`jobkit.jobs.http.fetch` is used):
  - Job-seeker landing ``/job-seeker/`` renders the current page of jobs as anchors
    ``/job-seeker/jobpage.html?jobId=<N>&countryId=<N>`` (a "View Details" button plus a card-title
    link per job). The landing page shows only ~10 unique jobs at a time. The ``countryId`` in the
    href is unreliable (the markup interleaves each job's id with its neighbour's country), so only
    the ``jobId`` is taken from the listing; the country is read from the detail page instead.
  - Pagination: ``/job-seeker/?pageNo=<N>`` is honoured server-side and returns a fresh set of ~10
    jobs per page (newest first), so ``fetch_all`` can pull far more than the landing set (~175
    live jobs across ~18 pages at time of writing). An out-of-range page returns zero job anchors,
    which is the stop signal. The on-site search (``POST /TEFL_WORKER/?action=search_jobs``) just
    redirects back to the landing page and its results are AJAX-loaded, so ``?pageNo`` is the only
    anonymous way to walk the full set.
  - Detail page ``/job-seeker/jobpage.html?jobId=<N>`` is fully fetchable with only the ``jobId``
    (the ``countryId`` is cosmetic). It embeds a single ``ld+json`` ``JobPosting`` with ``title``,
    ``datePosted``, ``validThrough`` (closing date), ``hiringOrganization`` (employer),
    ``jobLocation`` (locality + ``addressCountry``) and an HTML ``description`` holding the full
    body, including a "Salary and Benefits" sub-section when the employer supplies one.

Applications are on-site and login-gated, so no email is harvested by default; the jobpage URL is
stored in ``fields["apply_url"]`` (as the SeriousTeachers adapter does). An employer email is only
recorded when one is plainly present in the page text.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from bs4 import BeautifulSoup, Tag

from jobkit.jobs.http import fetch
from jobkit.jobs.models import DiscoveredJob, DiscoveryResult, JobPosting

BOARD = "tefl"
BASE = "https://www.tefl.com"
LANDING_PATH = "/job-seeker/"
DETAIL_PATH = "/job-seeker/jobpage.html"

JOB_ID_RE = re.compile(r"jobpage\.html\?jobId=(\d+)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
SALARY_RE = re.compile(r"Salary and Benefits\s*(.+?)$", re.IGNORECASE)

DEFAULT_LIMIT = 15
BODY_EXCERPT_CHARS = 1500
SALARY_MAX_CHARS = 200
SLEEP_SECONDS = 1.0


def _detail_url(job_id: str) -> str:
    """Absolute detail URL for a job id (``countryId`` is cosmetic and omitted)."""
    return f"{BASE}{DETAIL_PATH}?jobId={job_id}"


def _list_url(page: int = 1) -> str:
    """Landing/listing URL for a 1-based page number."""
    return f"{BASE}{LANDING_PATH}" if page <= 1 else f"{BASE}{LANDING_PATH}?pageNo={page}"


def _clean(text: str) -> str:
    """Collapse whitespace (including NBSPs) to single spaces."""
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _job_ids(html: str) -> list[str]:
    """Return unique ``jobId`` values from a listing page, in document order (newest first)."""
    return list(dict.fromkeys(JOB_ID_RE.findall(html)))


def _job_posting_ld(soup: BeautifulSoup) -> dict[str, Any]:
    """Return the page's ``ld+json`` ``JobPosting`` object, or ``{}`` if absent/unparseable."""
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and data.get("@type") == "JobPosting":
            return data
    return {}


def _format_date(raw: str) -> str:
    """Trim an ISO-ish timestamp (``2025-11-14T18:08:57+0000``) to its ``YYYY-MM-DD`` date."""
    match = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
    return match.group(1) if match else raw


def _organization_name(org: Any) -> str:  # noqa: ANN401 - ld+json values are loosely typed.
    """Employer name from a ``hiringOrganization`` value (dict or bare string)."""
    if isinstance(org, dict):
        name = org.get("name")
        return _clean(name) if isinstance(name, str) else ""
    return _clean(org) if isinstance(org, str) else ""


def _location_fields(loc: Any) -> tuple[str, str]:  # noqa: ANN401 - loosely typed ld+json.
    """Return ``(location, country)`` from a ``jobLocation`` value."""
    if not isinstance(loc, dict):
        return (_clean(loc) if isinstance(loc, str) else "", "")
    location = _clean(str(loc.get("name", "")))
    country = ""
    address = loc.get("address")
    if isinstance(address, dict):
        country = _clean(str(address.get("addressCountry", "")))
        if not location:
            location = _clean(str(address.get("addressLocality", "")))
    return location, country


def _body_text(description_html: str) -> str:
    """Return cleaned full text of the ld+json HTML ``description`` (script/style stripped)."""
    soup = BeautifulSoup(description_html, "html.parser")
    for noise in soup(["script", "style"]):
        noise.decompose()
    return _clean(soup.get_text(" ", strip=True))


def _salary(body: str) -> str:
    """Extract the "Salary and Benefits" blurb from the body text when the employer supplies one."""
    match = SALARY_RE.search(body)
    if not match:
        return ""
    return _clean(match.group(1))[:SALARY_MAX_CHARS]


def _apply_email(soup: BeautifulSoup, body: str) -> str:
    """Return a plainly-present employer email (mailto first, then body text), else ``""``."""
    mailto = soup.select_one('a[href^="mailto:"]')
    if isinstance(mailto, Tag):
        href = mailto.get("href")
        if isinstance(href, str):
            addr = href[len("mailto:") :].split("?", 1)[0].strip()
            if "@" in addr:
                return addr
    match = EMAIL_RE.search(body)
    return match.group(0) if match else ""


def _parse_detail(job_id: str, html: str) -> JobPosting:
    """Build a :class:`JobPosting` from a detail page, driven by its ld+json ``JobPosting``."""
    soup = BeautifulSoup(html, "html.parser")
    ld = _job_posting_ld(soup)

    title = _clean(str(ld.get("title", "")))
    if not title:
        heading = soup.select_one("h2")
        if heading is not None:
            title = _clean(heading.get_text(" ", strip=True))

    location, country = _location_fields(ld.get("jobLocation"))
    company = _organization_name(ld.get("hiringOrganization"))
    raw = _body_text(str(ld.get("description", "")))
    body = raw[:BODY_EXCERPT_CHARS]

    fields: dict[str, str] = {"apply_url": _detail_url(job_id)}
    if company:
        fields["company"] = company
    if country:
        fields["country"] = country
    salary = _salary(raw)
    if salary:
        fields["Salary"] = salary
    posted = _format_date(str(ld.get("datePosted", "")))
    if posted:
        fields["posted"] = posted
    closing = _format_date(str(ld.get("validThrough", "")))
    if closing:
        fields["closing"] = closing
    if body:
        fields["body"] = body
    if raw:
        fields["raw"] = raw

    return JobPosting(
        board=BOARD,
        job_id=job_id,
        url=_detail_url(job_id),
        title=title,
        location=location,
        apply_email=_apply_email(soup, raw),
        fields=fields,
    )


def _collect(job_ids: list[str], limit: int | None) -> list[JobPosting]:
    """Fetch one detail page per job id (polite sleeps), capped at ``limit`` if given."""
    chosen = job_ids if limit is None else job_ids[:limit]
    out: list[JobPosting] = []
    for index, job_id in enumerate(chosen):
        if index:
            time.sleep(SLEEP_SECONDS)
        out.append(_parse_detail(job_id, fetch(_detail_url(job_id))))
    return out


def discover_latest(limit: int = DEFAULT_LIMIT) -> DiscoveryResult:
    """Discover enough newest list pages to satisfy the explicit latest sample."""
    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    pages_checked = 0
    while len(ids) < limit:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        page_ids = _job_ids(fetch(_list_url(page)))
        pages_checked += 1
        if page == 1 and not page_ids:
            msg = "TEFL.com first listing page exposed no stable job IDs"
            raise RuntimeError(msg)
        fresh = [job_id for job_id in page_ids if job_id not in seen]
        if not fresh:
            break
        seen.update(fresh)
        ids.extend(fresh)
        page += 1
    items = tuple(DiscoveredJob(job_id=job_id) for job_id in ids[:limit])
    return DiscoveryResult(
        items=items,
        complete=False,
        evidence={"pages_checked": str(pages_checked), "sample": str(len(items))},
    )


def discover_full() -> DiscoveryResult:
    """Discover list pages until the source returns no new IDs."""
    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    while True:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        page_ids = _job_ids(fetch(_list_url(page)))
        if page == 1 and not page_ids:
            msg = "TEFL.com first listing page exposed no stable job IDs"
            raise RuntimeError(msg)
        fresh = [job_id for job_id in page_ids if job_id not in seen]
        if not fresh:
            break
        seen.update(fresh)
        ids.extend(fresh)
        page += 1
    return DiscoveryResult(
        items=tuple(DiscoveredJob(job_id=job_id) for job_id in ids),
        complete=True,
        evidence={"pages_checked": str(page), "source_exhausted": "true"},
    )


def hydrate(discovered: DiscoveredJob) -> JobPosting:
    """Hydrate one TEFL.com detail page."""
    return _parse_detail(discovered.job_id, fetch(_detail_url(discovered.job_id)))


def fetch_listings(limit: int = DEFAULT_LIMIT) -> list[JobPosting]:
    """Fetch up to ``limit`` of the newest TEFL.com postings (one detail fetch per job).

    Reads the job-seeker landing page (jobs newest first), walking ``?pageNo=N`` only as far as
    needed to gather ``limit`` unique job ids, then fetches a detail page for each with ~1s sleeps.
    """
    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    while len(ids) < limit:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        fresh = [jid for jid in _job_ids(fetch(_list_url(page))) if jid not in seen]
        if not fresh:
            break
        seen.update(fresh)
        ids.extend(fresh)
        page += 1
    return _collect(ids, limit)


def fetch_all(*, max_pages: int | None = None, limit: int | None = None) -> list[JobPosting]:
    """Walk ``?pageNo=N`` up to ``max_pages``, fetching every detail page (polite sleeps).

    Each landing page exposes ~10 fresh jobs (newest first); the crawl stops early when a page
    yields no new job ids (the live set is exhausted) or when ``limit`` is reached. ``max_pages``
    bounds the listing requests — raise it (the live board is ~18 pages / ~175 jobs) for a fuller
    pull. This reaches clearly more than ``fetch_listings`` since the landing set is only one page.
    """
    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    while max_pages is None or page <= max_pages:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        fresh = [jid for jid in _job_ids(fetch(_list_url(page))) if jid not in seen]
        if not fresh:
            break
        seen.update(fresh)
        ids.extend(fresh)
        if limit is not None and len(ids) >= limit:
            break
        page += 1
    return _collect(ids, limit)


if __name__ == "__main__":
    for posting in fetch_listings(limit=5):
        print(f"[{posting.job_id}] {posting.title}")  # noqa: T201 - demo entry point.
        print(f"  url:      {posting.url}")  # noqa: T201
        print(f"  company:  {posting.fields.get('company', '')}")  # noqa: T201
        print(f"  location: {posting.location}")  # noqa: T201
        print(f"  country:  {posting.fields.get('country', '')}")  # noqa: T201
        print(f"  salary:   {posting.fields.get('Salary', '')}")  # noqa: T201
        print(f"  posted:   {posting.fields.get('posted', '')}")  # noqa: T201
        print(f"  closing:  {posting.fields.get('closing', '')}")  # noqa: T201
        print(f"  apply:    {posting.apply_email or posting.fields.get('apply_url', '')}")  # noqa: T201
        print(f"  raw len:  {len(posting.fields.get('raw', ''))}")  # noqa: T201
        print(f"  body:     {posting.fields.get('body', '')[:120]}...")  # noqa: T201
        print()  # noqa: T201
