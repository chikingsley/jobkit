# JobKit Outreach Product

Private, Cloudflare-hosted review queue for the personal teaching-job search. It imports the live
Serious Teachers private board, creates a tailored application draft for every job, supports
instruction-based revisions, and requires approval of an exact immutable draft before submission.

The current private beta also includes:

- an editable candidate profile and job preferences stored in D1;
- manually mapped qualification matching for the initial 14-job review set;
- hard-blocker hiding with an explicit “Show ineligible” control;
- country and fit-state filtering;
- a private R2 document library for future email attachments;
- cyan System, Light, and Dark themes using shadcn Base UI.

R2 objects have no public bucket URL. Document listing, upload, streaming, and deletion run through
the Worker API. The application currently has no authentication boundary; production deployment
must be protected by Cloudflare Access or an equivalent server-enforced identity layer. Uploads are
limited to PDF, DOCX, JPG, and PNG files of at most 10 MB.

## Local vertical slice

```bash
bun install
bun run types:worker
bunx wrangler d1 migrations apply jobkit-outreach --local
bun run dev

# in another shell, from this directory
bun run seed:private
```

Copy the four existing credentials from the repository root `.env` into an untracked `.dev.vars`
when live revision and submission are needed:

```text
SERIOUSTEACHERS_EMAIL=...
SERIOUSTEACHERS_PASSWORD=...
SUPERWHISPER_API_BASE=...
SUPERWHISPER_API_KEY=...
```

The initial UI is responsive web. An Expo client can consume the same API after this workflow is
proven.

## Docs

- [`docs/jobkit-product-prd.md`](docs/jobkit-product-prd.md)
- [`docs/outreach-and-product-design.md`](docs/outreach-and-product-design.md)
