# OCR benchmark fixtures

These fixtures contain synthetic JobKit data only. Generate the immutable test
artifacts with Chromium, upload them to the authenticated Test Lab, and compare
the deterministic, Codex vision, and Mistral OCR variants against `cases.json`.

```sh
chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=/tmp/jobkit-ocr/born-digital.pdf \
  "file://$PWD/tests/fixtures/test-lab/ocr/born-digital.html"
chromium --headless --no-sandbox --disable-gpu \
  --hide-scrollbars --window-size=900,1100 \
  --screenshot=/tmp/jobkit-ocr/scanned-page.png \
  "file://$PWD/tests/fixtures/test-lab/ocr/scanned-page.html"
chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=/tmp/jobkit-ocr/scanned-page.pdf \
  file:///tmp/jobkit-ocr/scanned-page.png
chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=/tmp/jobkit-ocr/layout-heavy.pdf \
  "file://$PWD/tests/fixtures/test-lab/ocr/layout-heavy.html"
```
