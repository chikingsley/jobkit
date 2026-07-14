# JobKit Outreach Product

Cloudflare-hosted teaching-job application workspace. It imports the live Serious Teachers private
board, creates tailored application drafts, supports instruction-based revisions, and requires
approval of an exact immutable draft before submission.

The current private beta also includes:

- Better Auth email/password identities with 30-day rolling D1 sessions;
- per-user candidate profiles, preferences, job workflow state, drafts, events, and documents;
- global job listings that can be matched independently for each user;
- manually mapped qualification matching for the initial 14-job review set;
- hard-blocker hiding with an explicit “Show ineligible” control;
- country and fit-state filtering;
- a private R2 document library for future email attachments;
- cyan System, Light, and Dark themes using shadcn Base UI.

R2 objects have no public bucket URL. Document listing, upload, streaming, and deletion run through
authenticated, ownership-scoped Worker routes. Uploads are limited to PDF, DOCX, JPG, and PNG files
of at most 10 MB.

Cloudflare Access and Better Auth solve different layers. Better Auth is the product identity and
ownership boundary. Access is an optional outer gate for the private pre-launch hostname. Enable
Access before the first production registration: the first authenticated user intentionally claims
the data that predates multi-user authentication.

## Local vertical slice

```bash
bun install
bun run types:worker
bunx wrangler d1 migrations apply jobkit-outreach --local
bun run dev

# in another shell, from this directory
bun run seed:private
```

Create an account once in the local UI. Better Auth stores the session in D1 and a protected,
HttpOnly browser cookie, so normal development-server restarts do not require another sign-in.

Keep local credentials in an untracked, mode-600 `.dev.vars` file:

```text
BETTER_AUTH_SECRET=...
CEREBRAS_API_KEY=...
MISTRAL_API_KEY=...
MAPBOX_ACCESS_TOKEN=...
SERIOUSTEACHERS_EMAIL=...
SERIOUSTEACHERS_PASSWORD=...
```

Before production rollout, set `BETTER_AUTH_SECRET` as a Worker secret, protect the bootstrap with
Cloudflare Access, back up D1, apply every pending migration in order, and only then deploy the
Worker. Do not deploy the authenticated Worker against the pre-auth schema.

The initial UI is responsive web. An Expo client can consume the same API after this workflow is
proven.

## Docs

- [`docs/jobkit-product-prd.md`](docs/jobkit-product-prd.md)
- [`docs/outreach-and-product-design.md`](docs/outreach-and-product-design.md)
