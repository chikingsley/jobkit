import type {
  JobPositionAnalysis,
  JobPositionVariant,
} from "../jobs/position-variants";

const SOURCE_POSITION_NAMESPACE = "jobkit-source-position/v1";

export interface SourcePositionIdentity {
  id: string;
  positionKey: string;
  positionKind: "direct" | "extracted";
  sourceOrdinal: number;
}

export class SourcePositionIdentityError extends Error {
  readonly code = "source_position_key_collision";

  constructor() {
    super("Two positions produced the same stable source-position identity");
    this.name = "SourcePositionIdentityError";
  }
}

export async function sourcePositionIdentities(
  listingId: string,
  analysis: JobPositionAnalysis
): Promise<SourcePositionIdentity[]> {
  const discriminators = analysis.positions.map((position) =>
    analysis.scope === "direct"
      ? "direct"
      : extractedPositionDiscriminator(position)
  );
  if (new Set(discriminators).size !== discriminators.length) {
    throw new SourcePositionIdentityError();
  }

  const identities = await Promise.all(
    discriminators.map(async (discriminator, sourceOrdinal) => {
      const positionKind: SourcePositionIdentity["positionKind"] =
        discriminator === "direct" ? "direct" : "extracted";
      const positionKey =
        positionKind === "direct"
          ? "direct"
          : `position_v1_${await sha256(discriminator)}`;
      const id = `spos_v1_${await sha256(
        `${SOURCE_POSITION_NAMESPACE}\0${listingId}\0${discriminator}`
      )}`;
      return { id, positionKey, positionKind, sourceOrdinal };
    })
  );
  return identities;
}

export function extractedPositionDiscriminator(
  position: Pick<JobPositionVariant, "roleFamily" | "subjects" | "title">
) {
  const subjects = [
    ...new Set(
      position.subjects
        .map((subject) => normalizeIdentityText(subject.value))
        .filter(Boolean)
    ),
  ].sort();
  return JSON.stringify({
    roleFamily: position.roleFamily,
    subjects,
    title: normalizeIdentityText(position.title),
  });
}

export function normalizeIdentityText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
