# Document extraction and OCR spike

Date: 2026-07-19 UTC  
Fixture manifest: `tests/fixtures/test-lab/ocr/cases.json`  
Mistral model: `mistral-ocr-latest`  
Codex model: `gpt-5.6-terra`

## Purpose

This recorded Test Lab spike compares deterministic extraction, Mistral OCR,
and Codex vision on immutable, synthetic document versions. The fixtures
contain no candidate, employer, or school data.

Each score is token F1 against the fixture's labeled transcript. Latency is the
provider or extractor wall time recorded by JobKit. Markdown formatting can
make exact string equality false even when token F1 is 1.0.

## Results

| Fixture | Deterministic | Mistral OCR | Codex vision |
| --- | ---: | ---: | ---: |
| Born-digital PDF | 1.000 / 109 ms | 1.000 / 775 ms | 1.000 / 5,373 ms |
| Scanned page PNG | 0.000 / 79 ms | 1.000 / 1,127 ms | 1.000 / 6,189 ms |
| Scanned page PDF | 0.000 / 80 ms | 1.000 / 1,223 ms | 1.000 / 9,150 ms |
| Layout-heavy PDF | 1.000 / 136 ms | 1.000 / 1,212 ms | 1.000 / 6,584 ms |

The corresponding Test Lab run IDs are:

- Born-digital PDF: `a2e89dcd-8d90-4d2e-a1fd-37b1346f3fe1`,
  `6691926a-048a-4b2f-a7ff-7378fabf25c1`, and
  `ca489d1a-cb3f-4a75-a015-4f5af9229faa`.
- Scanned page PNG: `09bfa7d4-6054-456f-b22e-2309d55063c7`,
  `e309f0dc-d813-41b4-9910-bddcbe40db05`, and
  `ecef461d-d199-44c7-a61f-2557c0932bf6`.
- Scanned page PDF: `fcd2ee84-9b08-4e81-b72b-8d5c045c0634`,
  `98abb2ef-9f41-448b-9ea9-37a8734a326b`, and
  `92421e40-57ad-45e5-bfa0-eee21ba382ce`.
- Layout-heavy PDF: `e4aeb086-761f-4c81-96c8-8c859c08c5eb`,
  `f22e0e75-51f7-4426-bb11-e2e4d8a431d9`, and
  `5819e304-a283-44f0-b9d4-92b17254ade7`.

## Promotion decision

JobKit uses this extraction policy:

1. Extract PDF, DOCX, Markdown, and plain text deterministically.
2. Treat an empty deterministic PDF or DOCX result as unreadable and continue
   to OCR.
3. Use Mistral OCR for images and scanned documents. On the two scan forms it
   matched Codex's labeled-text score and completed about 5.5 to 7.5 times
   faster.
4. Keep Codex vision as an explicit Test Lab comparator and audit tool. It is
   not the production OCR fallback.

This promotes Mistral only for document OCR. It is not a reasoning,
classification, matching, research, or drafting provider. The current evidence
is synthetic and English-language; consented multilingual and degraded-scan
fixtures can extend the benchmark without changing the production routing
contract.

## Primary references

- [Mistral Document AI OCR processor](https://docs.mistral.ai/studio-api/document-processing/basic_ocr)
- [Mistral Document AI overview](https://docs.mistral.ai/studio-api/document-processing/overview)
- [unpdf source and documentation](https://github.com/unjs/unpdf)
