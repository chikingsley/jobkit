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

## sources/state-dept-activities/ — PUBLIC DOMAIN (classroom activity banks)

Three more americanenglish.state.gov (US State Department) titles, same public-domain status as `state-dept-shaping` (17 U.S.C. §105 — commercial reuse OK; screen any embedded third-party photos before reuse). Downloaded 2026-06-07 with `curl -skL` because the server still presents the wrong cert (`eca.dev.state.gov` on the prod domain). ~158,000 words of extractable activity prose across the PDFs:

- **Activate: Games for Learning American English** — `activate-teachers-manual_508.pdf` (the teacher's manual, 118 pp / ~27,500 words). The activity book itself is published only as ebook on the site, so `activate-games.epub` + `activate-games.mobi` are included for that content.
- **Create to Communicate: Art Activities for the EFL Classroom** — `create-to-communicate_2nd-edition_508.pdf` (the full 2nd edition, 176 pp / ~43,000 words) plus the four standalone chapter PDFs: `_1_drawing` (50 pp / ~11,600 w), `_2_collage` (45 pp / ~12,100 w), `_3_sculpture` (73 pp / ~15,500 w), `_4_mixed-media` (51 pp / ~13,700 w).
- **Dialogs for Everyday Use** — `dialogs-for-everyday-use_508.pdf` (61 pp / ~9,200 words) — short situational dialogs for speaking practice.
- `SHA256SUMS` — checksums. ⚠️ Same wrong-cert caveat as `state-dept-shaping`; re-download once fixed.
- Re-download: file URLs are `https://americanenglish.state.gov/files/ae/resource_files/<name>` (see the resource pages for the original `<name>`s; filenames here were normalized on save).

## sources/ipa/ — CC BY-SA 4.0 (phonetics chart)

The official International Phonetic Alphabet chart ("IPA Kiel", current English edition) from internationalphoneticassociation.org. Downloaded 2026-06-07. **CC BY-SA 4.0** (the IPA site states 4.0, not the 3.0 sometimes quoted) — any reproduction or adaptation must carry the same license and the prescribed attribution; full license + exact attribution string are in `sources/ipa/README.md`.

- `IPA_Kiel_chart.pdf` (1 p, vector) + `IPA_Kiel_chart_1200.png` (10200×13200) + `IPA_Kiel_chart_0600.png` (5100×6600) — the same chart as PDF and two raster sizes.
- `README.md` — license text + required attribution. `SHA256SUMS` — checksums.

## sources/las-vegas-teaching-archive/ — COPYRIGHTED (owner's job archive; reference + personal use)

The user's faculty archive from his Las Vegas teaching job (2021-22 era), copied 2026-06-07 from `/mnt/media/gmk-server-share/Business/Teaching English/` (Mac cruft stripped; non-teaching items like Taxes/ and business decks preserved as found — owner will sort). 2.1 GB, 1,163 files: final exams + answer keys by textbook (Interchange 2/3, Passages 1/2, Grammar and Beyond 1-4, Let's Talk, Real Talk, Ventures, Clear Speech, Final Draft, more), the full textbook listening audio (714 mp3/wma), syllabi, the student handbook. 2026-06-08: added the complete Interchange 5th-edition book sets (Intro/1/2/3 — Student Book, Teacher Book, Workbook, Video Resource Book; 16 PDFs, ~1.3GB) pulled from the owner Mac Downloads, under AUDIO- BOOKS/INTERCHANGE- 5TH EDITION/BOOKS/. Gitignored.

Use: coverage/accuracy REFERENCE for the grammar (M2/M3) and pronunciation (M6) modules and quiz-difficulty calibration — never copy its text/exercises into the published course. Personal lesson-prep use is unrestricted (owner's own materials). `transcripts.jsonl` (word-timestamped, ElevenLabs Scribe via the Superwhisper proxy) sits alongside for the owner's lesson tool.

## sources/teacherrecord-120hr-tefl/ — COPYRIGHTED (reference only, never publish)

Full prose of a competitor's 120-hr course (~210k words, 13 modules), pulled from a registered account. Local reference for structure/coverage comparison only; the publishable artifact derived from it is the topic outline in [course-structure-reference.md](course-structure-reference.md). Never commit, never reuse text.

## Related docs in this folder

- [business-research.md](business-research.md) — accreditation economics, the SeriousTEFL model, legal basis for the corpus.
- [course-structure-reference.md](course-structure-reference.md) — the teacherrecord module/unit map (structure only).
- [course-generation-pipeline.md](course-generation-pipeline.md) — the source-first build design with the zero-AI-isms enforcement gate.
