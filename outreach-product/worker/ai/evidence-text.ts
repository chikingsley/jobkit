const PUNCTUATION_FOLDS: Record<string, string> = {
  " ": " ",
  " ": " ",
  "‐": "-",
  "‑": "-",
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  " ": " ",
  "′": "'",
  "″": '"',
  "−": "-",
};

const PUNCTUATION_PATTERN = /[‘’‛′“”„″‐‑–—−   ]/g;

// Each mapped codepoint is a single BMP character replaced by one ASCII
// character, so the folded string keeps the original length and indices into
// it still address the original source.
export function foldEvidencePunctuation(value: string): string {
  return value.replace(
    PUNCTUATION_PATTERN,
    (char) => PUNCTUATION_FOLDS[char] ?? char
  );
}

export function evidenceIsPresent(source: string, evidence: string): boolean {
  const quote = evidence.trim();
  if (quote.length === 0) {
    return false;
  }
  return foldEvidencePunctuation(source).includes(
    foldEvidencePunctuation(quote)
  );
}
