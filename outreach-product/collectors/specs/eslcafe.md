# ESL Cafe source contract

Live check: 2026-07-20. The JSON request shape is also captured in `eslcafe.openapi.yaml`.

- Origin: `https://www.eslcafe.com`.
- Partitions: `china`, `international`, and `korea` are independent inventories.
- Stable identity: source `slug` returned by `GET /api/list/PostAJobList`.
- Completion proof: every selected partition is paged to its reported `lastPage`; page metadata must remain consistent and unique slugs must equal the source-reported total.
- Detail: `/postajob-detail/{slug}` may use standard `div.job-details` markup or a free-form advertiser page. The list summary remains canonical identity when the presentation template differs.
- Contact and application: decode all `data-cfemail` nodes, preserve direct email, and select a real external application route when present.
- Scope facts: the `china` and `korea` partitions carry `China` and `South Korea`; the international partition does not guess a country from prose.
