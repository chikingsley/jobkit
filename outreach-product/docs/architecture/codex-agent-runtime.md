# Codex companion runtime

## Decision

JobKit uses a paired local Codex CLI as its authoritative reasoning and agentic execution layer. Cloudflare remains authoritative for identity, persistence, leases, schedules, validation, Gmail state, send claims, deduplication, and audit history. Jina is an optional measured capability provider. Mistral is a temporary OCR benchmark adapter and is not a reasoning fallback.

This split keeps long-running work outside the Worker request lifetime while preserving hosted, user-owned state and deterministic execution gates.

## Pairing and execution

1. The user installs Codex and completes `codex login`.
1. An authenticated JobKit session creates a random one-time pairing code. The database stores only its SHA-256 hash and expiry.
1. `jobkit agent connect` exchanges that code over HTTPS. JobKit returns one revocable companion token and stores only its hash.
1. `jobkit agent start` polls for work over outbound HTTPS. It does not open an inbound port, use SSH, copy Codex credentials, or read Codex auth files.
1. A claim atomically leases one compatible domain task and records its task type, source ID and hash, prompt version and hash, selected model, reasoning effort, runner, and lease.
1. The companion runs `codex exec --ephemeral` with a strict JSON Schema and returns the parsed result to the exact run ID.
1. The Worker revalidates the schema, exact evidence, current source hash, ownership, lease owner, and domain invariants before changing application state.

Pairing codes are short-lived because they are displayed in the browser and used once. Companion tokens are long-lived enough for unattended outbound polling, remain revocable, and never enter browser storage.

## Local trust boundary

Every task runs from a newly created empty temporary directory. The companion:

- uses Codex read-only sandboxing and a non-interactive deny-by-default approval policy;
- ignores user Codex configuration and user/project execution rules;
- receives only an explicit allowlist of benign process environment variables, excluding Worker, Gmail, Cloudflare, Jina, Mistral, and board credentials;
- receives web search only for a task whose envelope explicitly enables it;
- removes the temporary task directory at completion or failure; and
- returns only the schema-constrained final result.

These controls reduce prompt-injection reach. They do not make web or document content trusted. Prompts identify source content as untrusted, and the Worker must still enforce literal evidence and deterministic post-validation.

## Task classes and models

- Luna handles repeatable extraction, classification, and high-volume drafting.
- Terra handles ambiguous research and revisions.
- Sol handles difficult audits and coverage reviews.

Model choice is part of the versioned task definition, not a user-facing provider menu. A model change therefore produces new provenance and can be evaluated before promotion.

## OpenCode fallback engine

The companion supports a second execution engine for provider outages. `JOBKIT_AGENT_ENGINE=opencode` switches execution from `codex exec` to `opencode run --pure --format json` while every other stage of the contract stays identical: the same claim, lease, heartbeat, artifact verification, JSON output parsing, completion posting, and Worker-side schema, evidence, and invariant revalidation.

Engine differences the fallback compensates for:

- OpenCode has no output-schema flag, so the runner appends the task's JSON Schema to the prompt and extracts the single JSON object from the final assistant message before the normal parse step.
- OpenCode has no read-only sandbox flag, so the runner sets a deny-by-default `OPENCODE_PERMISSION` for the spawned process, allowing `webfetch` only when the task envelope enables web search. Tasks still run from an empty temporary directory with the same benign environment allowlist.
- The task envelope's Codex model does not exist on OpenCode, so the runner maps task types to OpenCode models: `opencode-go/deepseek-v4-flash` for extraction and evaluation task types, `opencode-go/glm-5.2` for drafting, vision, OCR, and country sweeps. `JOBKIT_OPENCODE_MODELS` (a JSON object keyed by task type, `country_sweep.*` wildcard supported) and `JOBKIT_OPENCODE_DEFAULT_MODEL` override the mapping without a deploy.
- Codex reasoning effort has no uniform OpenCode equivalent, so the envelope's effort is not forwarded.

The default engine remains `codex`; the fallback activates only through the environment on the runner host.

### Local OpenAI-compatible endpoints

The fallback engine reaches any model OpenCode can reach, including a locally served model. Declare a custom provider in the runner host's `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local Docker",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "<model-id>": { "name": "<model-id>" } }
    }
  }
}
```

Use `http://localhost:11434/v1` for an Ollama container, `http://localhost:12434/engines/v1` for Docker Model Runner with TCP host access enabled, or any other `/v1/chat/completions` endpoint. When the config restricts `enabled_providers`, the custom provider id must be added to that list. The runner then targets it with `JOBKIT_OPENCODE_DEFAULT_MODEL="local/<model-id>"` or per task type through `JOBKIT_OPENCODE_MODELS`; no code change is involved because model ids are opaque `provider/model` strings to the runner.

## Local direct engine

`JOBKIT_AGENT_ENGINE=local` is a third engine that posts the task prompt straight to a local OpenAI-compatible `/v1/chat/completions` endpoint with no agent harness in between. It exists for small-context local servers: an agent harness injects tens of thousands of tokens of agent context, while the direct call sends only the task prompt plus the appended JSON Schema — the same schema-embedded contract the OpenCode engine uses. Requests run at temperature 0 with `stream: false`.

Configuration comes from the environment:

- `JOBKIT_LOCAL_LLM_BASE_URL` (default `http://127.0.0.1:8030/v1`; a runner on a different machine than the server sets this to the server's tunnel URL plus `/v1`, e.g. `https://llamacpp.peacockery.studio/v1`)
- `JOBKIT_LOCAL_LLM_MODEL` (default `qwen35-9b-ud-q4-k-xl`)
- `JOBKIT_LOCAL_LLM_KEY_FILE` (default `/home/simon/docker/llamacpp-llm/secrets/llamacpp-api-key`) — the bearer key is read from this file and never logged
- `JOBKIT_LOCAL_LLM_MAX_TOKENS` (default `4096`)
- `JOBKIT_LOCAL_LLM_MODELS` — optional JSON object keyed by task type (`country_sweep.*` wildcard supported) for multi-model rigs
- `JOBKIT_LOCAL_LLM_THINKING` (default `0`) — requests send `chat_template_kwargs: {"enable_thinking": false}` unless enabled, matching the validated non-thinking benchmark shape; with thinking enabled, hybrid-reasoning models can exhaust the whole token budget on reasoning before any final content appears

Engine behavior:

- Thinking models return `reasoning_content` alongside the final `content`; the runner reads only `content` and never parses reasoning.
- A completion that exhausts `max_tokens` before emitting final content fails with a distinct truncation error rather than a generic schema failure.
- Connection failures are retried a bounded number of times with a short delay inside the task timeout, because an idle local server may be mid-restart. The runner never starts the server itself.
- Image and PDF artifact tasks fail immediately with an engine-unsupported error and stay queued for a vision-capable engine.
- Worker-side schema, evidence, and invariant revalidation are identical to the other engines.

## Jina promotion contract

The protected `JINA_API_KEY` may power recorded evaluation variants for Reader, Search, embeddings, reranking, classification, deduplication, and DeepSearch. Each benchmark records input IDs, dataset version, expected output, variant, configuration, raw references, normalized result, timing, usage, errors, and human preference. A Jina capability is promoted independently only when the measured product result justifies the additional dependency. JobKit discloses the active provider for any promoted capability.

The 100-case real-inventory evaluation does not approve an automatic Jina stage. Reader and Search remain measured experiments rather than production dependencies; Codex owns open-web discovery, and a recurring structured source graduates to an Agent Browser-reviewed source contract and a JobKit-owned Go collector. The duplicate benchmark used shared recipient email as its label, contained reverse pairs and leaked identifiers, and had no no-match cases. It therefore supports a redesigned evaluation, not automatic entity merging. Nano at 256 dimensions is the candidate for fuzzy entity retrieval in that evaluation. Embeddings may retrieve candidates but never merge, suppress, or claim a recipient.

Reranking also remains behind a promotion gate. The first benchmark proved fast known-item retrieval after a country filter, because its query restated the target listing's own title, location, country, and salary. A profile- and preference-based evaluation must prove personalized ordering before the reranker writes production scores. When promoted, deterministic authorization, freshness, qualification, country, recipient, and campaign-policy rules admit candidates first. Stored scores are user- and context-specific and include the provider, model, input version, profile version, preference version, and computed time. UI filter changes read stored records and do not call Jina.

A Codex-only installation remains fully functional. An optional Jina-enabled installation must disclose whether it uses an owner-managed or user-provided key and record provider provenance. Classification, matching, Reader, Search, DeepSearch, and user-facing raw hybrid output remain evaluation-only. See [`../benchmarks/jina-real-capabilities-2026-07-20.md`](../benchmarks/jina-real-capabilities-2026-07-20.md) and the earlier [`../benchmarks/codex-jina-spike-2026-07-19.md`](../benchmarks/codex-jina-spike-2026-07-19.md).

## Document extraction contract

Born-digital PDF and DOCX documents use deterministic extraction first. Scanned or layout-heavy pages enter a recorded comparison between:

1. Codex vision using rendered page images and a strict extraction schema; and
1. Mistral OCR using its page, layout, table, and confidence output.

The recorded comparison promotes deterministic extraction for born-digital documents and Mistral OCR for images or scans whose deterministic result is empty. Codex vision remains an explicit audit comparator. Mistral has no reasoning, matching, research, classification, or drafting role. See [`../benchmarks/document-ocr-spike-2026-07-19.md`](../benchmarks/document-ocr-spike-2026-07-19.md).

## Failure behavior

- A task result is accepted only by the runner that owns the active run.
- A source change invalidates an old result through its source hash.
- An expired lease is auditable and may be reclaimed.
- A schema or evidence failure is retained for inspection instead of being retried in a hot loop.
- Explicit retry creates a new run; it does not rewrite the failed record.
- Sending is a separate deterministic state machine. Completing a reasoning task never authorizes or implies an external message.

## Primary references

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex approvals and sandboxing](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server)
- [Jina AI API](https://api.jina.ai/docs)
- [Jina MCP server](https://github.com/jina-ai/MCP)
- [Mistral OCR API](https://docs.mistral.ai/api/endpoint/ocr)
