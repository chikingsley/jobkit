# TEFL course — source corpus manifest

What's in `sources/`, where it came from, and the licensing status of each. The actual files are gitignored (bulk binaries / copyrighted text); this manifest plus `state-dept-shaping/SHA256SUMS` is the committed record. Downloaded 2026-06-07.

## sources/state-dept-shaping/ — PUBLIC DOMAIN (the build corpus)

"Shaping the Way We Teach English" from americanenglish.state.gov (US State Department). Public domain per 17 U.S.C. §105 and State's copyright notice — commercial reuse OK; the one legal task before reuse is screening out any embedded third-party media (licensed photos etc.). **~124,000 words of extractable teacher-training prose**, verified by direct text extraction:

- `introduction.pdf` + `module1...` through `module-14...` (14 module manuals, ~660–6,400 words each) + `appendix-additional-handouts.pdf` — the manual for the 14-module video course. Topics: contextualizing language, language awareness, integrating skills, pair/group work, learner feedback, managing large classes, learning strategies, authentic materials, critical/creative thinking, alternative assessment, individual learner differences, younger learners, peer observation, reflective teaching.
- `shaping_frm_observ_508.pdf` — *From Observation to Action*, the 204-page / ~72,000-word companion volume.
- `shaping_the_way_we_teach_series_1.{epub,mobi}` — the whole series as ebooks.
- `SHA256SUMS` — checksums (committed). ⚠️ Downloaded with TLS verification disabled because the server currently presents a wrong cert (`eca.dev.state.gov` on the prod domain); re-download and re-checksum once they fix it.
- **Videos (not downloaded yet):** the 14 module videos live on YouTube (American English channel, playlist `PL7BlTIDdOgZJXYuDJmqC_4B3i1WdCfLQt`). Grab with `yt-dlp` into this folder when wanted.
- Re-download: the file URLs are `https://americanenglish.state.gov/files/ae/resource_files/<name>` for every name in SHA256SUMS.

## sources/teacherrecord-120hr-tefl/ — COPYRIGHTED (reference only, never publish)

Full prose of a competitor's 120-hr course (~210k words, 13 modules), pulled from a registered account. Local reference for structure/coverage comparison only; the publishable artifact derived from it is the topic outline in [course-structure-reference.md](course-structure-reference.md). Never commit, never reuse text.

## Related docs in this folder

- [business-research.md](business-research.md) — accreditation economics, the SeriousTEFL model, legal basis for the corpus.
- [course-structure-reference.md](course-structure-reference.md) — the teacherrecord module/unit map (structure only).
- [course-generation-pipeline.md](course-generation-pipeline.md) — the source-first build design with the zero-AI-isms enforcement gate.
