import type { CanonicalListing } from "../02_extract/normalize";

export interface RankedListing extends CanonicalListing {
  monthlyUsd: number;
  repostedAs: string[];
}

function duplicateKey(listing: RankedListing) {
  return [
    listing.company.toLocaleLowerCase("en"),
    listing.country.toLocaleLowerCase("en"),
    Math.round(listing.monthlyUsd / 50),
  ].join("|");
}

export function rankListings(listings: CanonicalListing[]): RankedListing[] {
  const priced = listings
    .filter(
      (listing): listing is CanonicalListing & { monthlyUsd: number } =>
        listing.monthlyUsd !== null
    )
    .map((listing) => ({ ...listing, repostedAs: [] as string[] }))
    .sort((first, second) =>
      second.monthlyUsd === first.monthlyUsd
        ? first.id.localeCompare(second.id)
        : second.monthlyUsd - first.monthlyUsd
    );
  const kept: RankedListing[] = [];
  const byKey = new Map<string, RankedListing>();
  for (const listing of priced) {
    if (listing.company === "") {
      kept.push(listing);
      continue;
    }
    const key = duplicateKey(listing);
    const existing = byKey.get(key);
    if (existing) {
      existing.repostedAs.push(listing.id);
      continue;
    }
    byKey.set(key, listing);
    kept.push(listing);
  }
  return kept;
}
