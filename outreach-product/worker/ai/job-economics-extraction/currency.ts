// Common non-ISO codes seen in listings, mapped to the ISO code the FX
// rates table actually carries.
const CURRENCY_CODE_ALIASES: Record<string, string> = {
  MXP: "MXN",
  NTD: "TWD",
  RMB: "CNY",
};

export function normalizeCurrency(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? null;
  const currency = normalized
    ? (CURRENCY_CODE_ALIASES[normalized] ?? normalized)
    : null;
  const isCurrencyCode =
    currency?.length === 3 &&
    [...currency].every((character) => character >= "A" && character <= "Z");
  return isCurrencyCode ? currency : null;
}

export function isAsciiDigit(value: string) {
  return value >= "0" && value <= "9";
}
