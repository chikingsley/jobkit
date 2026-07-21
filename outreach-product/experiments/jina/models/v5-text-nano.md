# Jina embeddings v5 text nano

Official model page: <https://jina.ai/models/jina-embeddings-v5-text-nano/>

## Published model shape

- 239 million parameters
- text input
- 8,192-token context
- 768-dimensional output with Matryoshka truncation
- retrieval, text matching, clustering, and classification task adapters

## JobKit questions

Nano is the latency and local-deployment candidate. Compare it with v3 and v5 text small on the same examples, then inspect whether speed comes with systematic losses on multilingual, unclear, non-teaching, and subject-teaching listings.

Its smaller size makes GGUF and edge experiments relevant, but hosted API timing and local inference timing are different experiments and must not be combined in one result row.

The first JobKit zero-shot screen scored 7/20 with descriptive labels. A three-repeat wording control scored 0.350 accuracy with descriptive labels, 0.200 with concise labels, and 0.300 with canonical identifiers. The stable result leaves taxonomy accuracy below the promotion threshold despite nano's latency advantage.
