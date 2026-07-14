export interface LanguageSearchEntry {
  name: string;
  normalized: string;
}

let languageEntriesPromise: Promise<LanguageSearchEntry[]> | undefined;

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en");
}

export function loadLanguageEntries() {
  languageEntriesPromise ??= import("iso-639-3").then(({ iso6393 }) => {
    const names = iso6393
      .filter(
        (language) =>
          language.type !== "special" && language.scope !== "special"
      )
      .map((language) => language.name);

    return [...new Set(names)]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((name) => ({ name, normalized: normalize(name) }));
  });
  return languageEntriesPromise;
}

export function searchLanguageNames(
  entries: LanguageSearchEntry[],
  query: string,
  limit = 50
) {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return [];
  }

  return entries
    .filter((entry) => entry.normalized.includes(normalizedQuery))
    .sort((left, right) => {
      const leftStarts = left.normalized.startsWith(normalizedQuery);
      const rightStarts = right.normalized.startsWith(normalizedQuery);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "en");
    })
    .slice(0, limit)
    .map((entry) => entry.name);
}
