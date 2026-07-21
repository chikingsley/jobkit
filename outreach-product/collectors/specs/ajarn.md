# Ajarn source contract

Live check: 2026-07-20.

- Origin: `https://www.ajarn.com`.
- Stable identity: numeric ID in `/recruitment/jobs/{id}/{slug}`; the slug is cosmetic hydration metadata.
- Discovery: `GET /recruitment/jobs` exposes the complete live list in document order. The accepted `?page=2` route currently repeats the same identities. A full run requires that explicit second request to add no identity; a new identity on page 2 fails discovery and forces contract review.
- Detail: the `table.table` rows expose company, location, and salary in the observed fixed order. The main detail column contains the full source text.
- Contact: decode `data-cfemail`, then inspect `mailto`, then visible source text. When no address exists, preserve the source detail route as the application route.
- Scope fact: Ajarn is a Thailand-specific board, so collected rows carry `Thailand` without prose inference.
