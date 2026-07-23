export const degreeRanks = {
  associate: 1,
  bachelor: 2,
  certificate: 0,
  diploma: 0,
  doctorate: 4,
  master: 3,
  other: 0,
} as const;

export const languageRanks = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  native: 7,
} as const;

export const segmenter = new Intl.Segmenter("en", { granularity: "word" });
