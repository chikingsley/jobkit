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
