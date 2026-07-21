# TEFL.com source contract

Live check: 2026-07-20.

- Origin: `https://www.tefl.com`.
- Stable identity: numeric `jobId` in `jobpage.html?jobId={id}`. The listing's `countryId` is not treated as identity or country evidence.
- Discovery: `GET /job-seeker/?pageNo={page}` returns a fresh page of identities. A full run continues until a page adds no new identity; page one must never be empty.
- Detail: `GET /job-seeker/jobpage.html?jobId={id}` exposes a `JobPosting` JSON-LD object. The collector retains that object as source evidence and copies its title, organization, location, country, posted date, closing date, and HTML description.
- Compensation and requirements: prose under headings such as “Salary and Benefits” and “Qualifications” remains source text for the evidence-backed Codex analysis. The collector does not parse those paragraphs with regexes.
- Application: the public job detail route is retained as the login-gated application route unless the page exposes a direct email.
