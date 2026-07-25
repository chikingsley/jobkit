import type { CanonicalListing } from "../02_extract/normalize";

export interface RankedListing extends CanonicalListing {
  payKnown: boolean;
  repostedAs: string[];
}

const UNPRICED_BAND = -1;
const PAY_BAND_USD = 50;

function payBand(listing: RankedListing) {
  return listing.monthlyUsd === null
    ? UNPRICED_BAND
    : Math.round(listing.monthlyUsd / PAY_BAND_USD);
}

function duplicateKey(listing: RankedListing) {
  return [
    listing.company.toLocaleLowerCase("en"),
    listing.country.toLocaleLowerCase("en"),
    payBand(listing),
  ].join("|");
}

function byPayThenIdentifier(first: RankedListing, second: RankedListing) {
  if (first.payKnown !== second.payKnown) {
    return first.payKnown ? -1 : 1;
  }
  if (first.monthlyUsd !== null && second.monthlyUsd !== null) {
    return second.monthlyUsd === first.monthlyUsd
      ? first.id.localeCompare(second.id)
      : second.monthlyUsd - first.monthlyUsd;
  }
  return first.id.localeCompare(second.id);
}

export function rankListings(listings: CanonicalListing[]): RankedListing[] {
  const ordered = listings
    .map((listing) => ({
      ...listing,
      payKnown: listing.monthlyUsd !== null,
      repostedAs: [] as string[],
    }))
    .sort(byPayThenIdentifier);
  const kept: RankedListing[] = [];
  const byKey = new Map<string, RankedListing>();
  for (const listing of ordered) {
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
