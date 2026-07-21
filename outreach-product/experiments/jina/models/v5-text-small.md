# Jina embeddings v5 text small

Official model page: <https://jina.ai/models/jina-embeddings-v5-text-small/>

## Published model shape

- 677 million parameters
- text input
- 32,768-token context
- 1,024-dimensional output with Matryoshka truncation
- retrieval, text matching, clustering, and classification task adapters

## JobKit questions

Compare v5 text small directly with v3 on the identical zero-shot and private classifier corpora. Record class-level errors, provider-score separation, latency, and long-listing behavior. Its larger context may matter for full job descriptions, but that hypothesis must be tested on real long listings rather than inferred from the context limit.

The embedding track separately measures semantic duplicate detection and retrieval. A win there does not automatically promote the classifier.

The first JobKit zero-shot screen scored 5/20 with descriptive labels. A three-repeat wording control scored 0.250 accuracy with descriptive labels, 0.183 with concise labels, and 0.283 with canonical identifiers. The stable result keeps v5 text small in the lab for this taxonomy. Hosted private-classifier training remains a separate experiment.
