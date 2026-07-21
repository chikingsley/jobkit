# SeriousTeachers source contract

Live check: 2026-07-20.

- Origin: `https://www.seriousteachers.com`.
- Stable identity: numeric ID in `/job_details/{id}/0/{slug}`.
- Discovery: the homepage exposes active country IDs. A full run visits the homepage, each `/0/{country}/0` page, and each `/0/{country}/{subject}` page for subject IDs 1 through 14. The source has no usable pagination; the finite country-by-subject matrix is the completion proof.
- Missing matrix pages: explicit HTTP 404 and 410 responses are empty cells. Other HTTP failures stop discovery.
- Detail: the main detail column exposes the title, display location, labeled body fields, full source text, and an optional `/te2/login/{job}/{employer}` application route.
- Country: the collector copies the explicit country route used to discover an identity instead of splitting the display location.
- Authentication: public collection does not require a login. Optional `SERIOUSTEACHERS_EMAIL` and `SERIOUSTEACHERS_PASSWORD` credentials establish one cookie session and resolve gated application routes. A rejected login leaves the public gated route intact and never discards the job.
