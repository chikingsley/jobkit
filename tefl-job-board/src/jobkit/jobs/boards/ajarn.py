"""Ajarn.com (ajarn.com) adapter — Thailand's main foreign-teacher board, server-rendered, bs4.

Ajarn publishes direct-employer teaching ads for Thailand. The recruitment list is plain
server-rendered HTML (no JS needed):

  - List page ``/recruitment/jobs`` — carries every currently live posting in document order
    (newest first). Jobs appear as anchors ``/recruitment/jobs/<id>/<slug>`` split across three
    sections: ``section.premiumJobs`` (paid, listed first), ``section.featured`` (a duplicated
    subset of the premium jobs) and ``section.freeJobs``. The numeric id in the URL is the only
    reliable job marker; every other ``/recruitment/...`` link (``/recruitment/resumes``,
    ``/recruitment/faq``, the ``/recruitment/jobs`` nav link itself) lacks the ``/jobs/<digits>/``
    shape and is excluded. De-duplicating ids in document order yields a newest-first list.
  - The ``?page=N`` query param is accepted (HTTP 200) but Ajarn does NOT paginate the recruitment
    list server-side — every page returns the same full set, and there is no ``.pagination`` UI.
    ``fetch_all`` therefore still walks ``?page=N`` but its "stop when a page yields no new jobs"
    guard fires on page 2 (all ids already seen), so in practice one page covers the live board.
  - Detail pages ``/recruitment/jobs/<id>/<slug>`` carry a ``table.table`` summary block with rows
    in a fixed order: logo image (empty), company/school name, location, salary, and a contact
    cell. The body/description lives in ``div.col-md-pull-4.col-md-8`` and the post age in an
    ``h3.text-muted`` ("Posted 2 days ago").

Apply contact: employer emails are Cloudflare-obfuscated (``span[data-cfemail]`` hex, rendered as
"[email protected]"); these decode locally to the real address and are stored in ``apply_email``.
When no email is present the posting offers only the on-site "Send Resume" tool, so the detail URL
is stored in ``fields["apply_url"]`` like the SeriousTeachers adapter does.
"""

from __future__ import annotations

import re
import time

from bs4 import BeautifulSoup, Tag

from jobkit.jobs.http import fetch
from jobkit.jobs.models import DiscoveredJob, DiscoveryResult, JobPosting

BOARD = "ajarn"
BASE = "https://www.ajarn.com"
LIST_PATH = "/recruitment/jobs"

JOB_RE = re.compile(r"/recruitment/jobs/(\d+)/")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

DEFAULT_LIMIT = 15
DESCRIPTION_MAX = 1500
SLEEP_SECONDS = 1.0


def _attr(tag: Tag, name: str) -> str:
    """Return a tag attribute coerced to a plain ``str``."""
    value = tag.get(name)
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return " ".join(value)


def _clean(text: str) -> str:
    """Collapse whitespace (incl. the NBSPs Ajarn sprinkles into values)."""
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _detail_url(job_id: str, slug: str = "") -> str:
    """Absolute detail URL; the slug is cosmetic so an empty one still resolves."""
    return f"{BASE}{LIST_PATH}/{job_id}/{slug}"


def _list_url(page: int = 1) -> str:
    return f"{BASE}{LIST_PATH}" if page <= 1 else f"{BASE}{LIST_PATH}?page={page}"


def _list_jobs(html: str) -> list[tuple[str, str]]:
    """Return ``(job_id, slug)`` pairs in document order, de-duplicated, newest first."""
    soup = BeautifulSoup(html, "html.parser")
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for anchor in soup.select('a[href*="/recruitment/jobs/"]'):
        href = _attr(anchor, "href")
        match = JOB_RE.search(href)
        if not match:
            continue
        job_id = match.group(1)
        if job_id in seen:
            continue
        seen.add(job_id)
        slug = href.rstrip("/").rsplit("/", 1)[-1]
        out.append((job_id, slug))
    return out


def _decode_cfemail(token: str) -> str:
    """Decode a Cloudflare ``data-cfemail`` hex token (first byte is the XOR key)."""
    try:
        raw = bytes.fromhex(token)
    except ValueError:
        return ""
    if not raw:
        return ""
    key = raw[0]
    return "".join(chr(byte ^ key) for byte in raw[1:])


def _apply_email(soup: BeautifulSoup) -> str:
    """Find the employer email: Cloudflare-obfuscated span, then mailto, then plain text."""
    cf = soup.select_one("[data-cfemail]")
    if cf:
        decoded = _decode_cfemail(_attr(cf, "data-cfemail"))
        if "@" in decoded:
            return decoded
    mailto = soup.select_one('a[href^="mailto:"]')
    if mailto:
        addr = _attr(mailto, "href")[len("mailto:") :].split("?", 1)[0].strip()
        if "@" in addr:
            return addr
    match = EMAIL_RE.search(soup.get_text(" "))
    return match.group(0) if match else ""


def _summary_rows(soup: BeautifulSoup) -> list[str]:
    """Non-empty cell texts from the detail ``table.table`` summary, in order."""
    table = soup.select_one("table.table")
    if not table:
        return []
    rows: list[str] = []
    for tr in table.select("tr"):
        cells = tr.select("td, th")
        text = _clean(" ".join(c.get_text(" ", strip=True) for c in cells))
        if text and "[email" not in text:
            rows.append(text)
    return rows


def _posted(soup: BeautifulSoup) -> str:
    """Extract the 'Posted ...' age string from the ``h3.text-muted`` header, if present."""
    header = soup.select_one("h3.text-muted")
    if not header:
        return ""
    text = _clean(header.get_text(" ", strip=True))
    return re.sub(r"^Posted\s*", "", text, flags=re.IGNORECASE).strip()


def _body(soup: BeautifulSoup) -> str:
    """Full cleaned description text from the main column (uncapped)."""
    block = soup.select_one("div.col-md-pull-4.col-md-8")
    if not block:
        return ""
    return _clean(block.get_text(" ", strip=True))


def _parse_detail(job_id: str, slug: str, html: str) -> JobPosting:
    """Build a :class:`JobPosting` from a detail page's HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()

    h1 = soup.select_one("h1")
    title = _clean(h1.get_text(" ", strip=True)) if h1 else ""
    if not title and soup.title:
        title = _clean(soup.title.get_text(strip=True)).split(" job in ", 1)[0]

    rows = _summary_rows(soup)
    company = rows[0] if len(rows) >= 1 else ""
    location = rows[1] if len(rows) >= 2 else ""  # noqa: PLR2004
    salary = rows[2] if len(rows) >= 3 else ""  # noqa: PLR2004

    # Ajarn is a Thailand-only board, so the country is fixed (the location row is a city/region).
    fields: dict[str, str] = {"country": "Thailand"}
    if salary:
        fields["Salary"] = salary
    if company:
        fields["company"] = company
    posted = _posted(soup)
    if posted:
        fields["posted"] = posted
    body = _body(soup)
    if body:
        fields["raw"] = body
        fields["body"] = body[:DESCRIPTION_MAX]

    email = _apply_email(soup)
    if not email:
        fields["apply_url"] = _detail_url(job_id, slug)

    return JobPosting(
        board=BOARD,
        job_id=job_id,
        url=_detail_url(job_id, slug),
        title=title,
        location=location,
        apply_email=email,
        fields=fields,
    )


def _collect(jobs: list[tuple[str, str]], limit: int | None) -> list[JobPosting]:
    """Fetch one detail page per job (polite sleeps), capped at ``limit`` if given."""
    chosen = jobs if limit is None else jobs[:limit]
    out: list[JobPosting] = []
    for index, (job_id, slug) in enumerate(chosen):
        if index:
            time.sleep(SLEEP_SECONDS)
        out.append(_parse_detail(job_id, slug, fetch(_detail_url(job_id, slug))))
    return out


def discover_latest(limit: int = DEFAULT_LIMIT) -> DiscoveryResult:
    """Discover newest Ajarn IDs and their cosmetic slugs."""
    jobs = _list_jobs(fetch(_list_url()))
    if not jobs:
        msg = "Ajarn first listing page exposed no stable job IDs"
        raise RuntimeError(msg)
    items = tuple(
        DiscoveredJob(job_id=job_id, metadata={"slug": slug}) for job_id, slug in jobs[:limit]
    )
    return DiscoveryResult(
        items=items,
        complete=False,
        evidence={"sample": str(len(items))},
    )


def discover_full() -> DiscoveryResult:
    """Discover until the source returns no new IDs; Ajarn currently exhausts on page two."""
    jobs: list[tuple[str, str]] = []
    seen: set[str] = set()
    page = 1
    while True:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        page_jobs = _list_jobs(fetch(_list_url(page)))
        if page == 1 and not page_jobs:
            msg = "Ajarn first listing page exposed no stable job IDs"
            raise RuntimeError(msg)
        fresh = [(job_id, slug) for job_id, slug in page_jobs if job_id not in seen]
        if not fresh:
            break
        for job_id, slug in fresh:
            seen.add(job_id)
            jobs.append((job_id, slug))
        page += 1
    return DiscoveryResult(
        items=tuple(DiscoveredJob(job_id=job_id, metadata={"slug": slug}) for job_id, slug in jobs),
        complete=True,
        evidence={"pages_checked": str(page), "source_exhausted": "true"},
    )


def hydrate(discovered: DiscoveredJob) -> JobPosting:
    """Hydrate one Ajarn detail page."""
    slug = discovered.metadata.get("slug", "")
    return _parse_detail(
        discovered.job_id,
        slug,
        fetch(_detail_url(discovered.job_id, slug)),
    )


def fetch_listings(limit: int = DEFAULT_LIMIT) -> list[JobPosting]:
    """Fetch up to ``limit`` of the newest Ajarn postings (one detail fetch per job).

    Reads the single recruitment list page (jobs are listed newest first) and fetches a detail
    page for each of the first ``limit`` jobs, with ~1s sleeps between detail fetches.
    """
    jobs = _list_jobs(fetch(_list_url()))
    return _collect(jobs, limit)


def fetch_all(*, max_pages: int | None = None, limit: int | None = None) -> list[JobPosting]:
    """Walk ``?page=N`` up to ``max_pages``, fetching every detail page (polite sleeps).

    Stops early when a page yields no new job ids. Ajarn serves the full live board on every page
    (the ``?page=N`` param does not actually paginate), so this normally stops after page 1 once
    page 2 repeats the same ids; ``max_pages`` is a safety bound for future server changes.
    """
    jobs: list[tuple[str, str]] = []
    seen: set[str] = set()
    page = 1
    while max_pages is None or page <= max_pages:
        if page > 1:
            time.sleep(SLEEP_SECONDS)
        page_jobs = _list_jobs(fetch(_list_url(page)))
        fresh = [(jid, slug) for jid, slug in page_jobs if jid not in seen]
        if not fresh:
            break
        for jid, slug in fresh:
            seen.add(jid)
            jobs.append((jid, slug))
        if limit is not None and len(jobs) >= limit:
            break
        page += 1
    return _collect(jobs, limit)


if __name__ == "__main__":
    for posting in fetch_listings(limit=5):
        print(f"[{posting.job_id}] {posting.title}")  # noqa: T201 - demo entry point.
        print(f"  url:      {posting.url}")  # noqa: T201
        print(f"  company:  {posting.fields.get('company', '')}")  # noqa: T201
        print(f"  location: {posting.location}")  # noqa: T201
        print(f"  salary:   {posting.fields.get('Salary', '')}")  # noqa: T201
        print(f"  posted:   {posting.fields.get('posted', '')}")  # noqa: T201
        print(f"  apply:    {posting.apply_email or posting.fields.get('apply_url', '')}")  # noqa: T201
        print(f"  body:     {posting.fields.get('body', '')[:120]}...")  # noqa: T201
        print()  # noqa: T201
