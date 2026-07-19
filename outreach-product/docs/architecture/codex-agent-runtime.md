# Codex companion runtime

## Decision

JobKit uses a paired local Codex CLI as its authoritative reasoning and agentic
execution layer. Cloudflare remains authoritative for identity, persistence,
leases, schedules, validation, Gmail state, send claims, deduplication, and
audit history. Jina is an optional measured capability provider. Mistral is a
temporary OCR benchmark adapter and is not a reasoning fallback.

This split keeps long-running work outside the Worker request lifetime while
preserving hosted, user-owned state and deterministic execution gates.

## Pairing and execution

1. The user installs Codex and completes `codex login`.
2. An authenticated JobKit session creates a random one-time pairing code. The
   database stores only its SHA-256 hash and expiry.
3. `jobkit agent connect` exchanges that code over HTTPS. JobKit returns one
   revocable companion token and stores only its hash.
4. `jobkit agent start` polls for work over outbound HTTPS. It does not open an
   inbound port, use SSH, copy Codex credentials, or read Codex auth files.
5. A claim atomically leases one compatible domain task and records its task
   type, source ID and hash, prompt version and hash, selected model, reasoning
   effort, runner, and lease.
6. The companion runs `codex exec --ephemeral` with a strict JSON Schema and
   returns the parsed result to the exact run ID.
7. The Worker revalidates the schema, exact evidence, current source hash,
   ownership, lease owner, and domain invariants before changing application
   state.

Pairing codes are short-lived because they are displayed in the browser and
used once. Companion tokens are long-lived enough for unattended outbound
polling, remain revocable, and never enter browser storage.

## Local trust boundary

Every task runs from a newly created empty temporary directory. The companion:

- uses Codex read-only sandboxing and a non-interactive deny-by-default approval
  policy;
- ignores user Codex configuration and user/project execution rules;
- receives only an explicit allowlist of benign process environment variables,
  excluding Worker, Gmail, Cloudflare, Jina, Mistral, and board credentials;
- receives web search only for a task whose envelope explicitly enables it;
- removes the temporary task directory at completion or failure; and
- returns only the schema-constrained final result.

These controls reduce prompt-injection reach. They do not make web or document
content trusted. Prompts identify source content as untrusted, and the Worker
must still enforce literal evidence and deterministic post-validation.

## Task classes and models

- Luna handles repeatable extraction, classification, and high-volume drafting.
- Terra handles ambiguous research and revisions.
- Sol handles difficult audits and coverage reviews.

Model choice is part of the versioned task definition, not a user-facing
provider menu. A model change therefore produces new provenance and can be
evaluated before promotion.

## Jina promotion contract

The protected `JINA_API_KEY` may power recorded evaluation variants for Reader,
Search, embeddings, reranking, classification, deduplication, and DeepSearch.
Each benchmark records input IDs, dataset version, expected output, variant,
configuration, raw references, normalized result, timing, usage, errors, and
human preference. A Jina capability is promoted independently only when the
measured product result justifies the additional dependency. JobKit discloses
the active provider for any promoted capability.

## Document extraction contract

Born-digital PDF and DOCX documents use deterministic extraction first. Scanned
or layout-heavy pages enter a recorded comparison between:

1. Codex vision using rendered page images and a strict extraction schema; and
2. Mistral OCR using its page, layout, table, and confidence output.

The comparison evaluates field accuracy, reading order, tables, evidence
location, multilingual text, latency, cost or usage, and failure recovery.
Mistral remains isolated behind this benchmark and is removed if it does not win
a promoted OCR role.

## Failure behavior

- A task result is accepted only by the runner that owns the active run.
- A source change invalidates an old result through its source hash.
- An expired lease is auditable and may be reclaimed.
- A schema or evidence failure is retained for inspection instead of being
  retried in a hot loop.
- Explicit retry creates a new run; it does not rewrite the failed record.
- Sending is a separate deterministic state machine. Completing a reasoning
  task never authorizes or implies an external message.

## Primary references

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex approvals and sandboxing](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server)
- [Jina AI API](https://api.jina.ai/docs)
- [Jina MCP server](https://github.com/jina-ai/MCP)
- [Mistral OCR API](https://docs.mistral.ai/api/endpoint/ocr)
