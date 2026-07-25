import { normalizeIdentityText } from "./source-position-identity";

const IDENTITY_SIGNAL_NAMESPACE = "jobkit-public-identity-signal/v1";

export type PublicIdentitySignalKind =
  | "canonical_identity_v1"
  | "material_clone_v1"
  | "source_reference_v1";

export interface PublicIdentitySignal {
  hash: string;
  kind: PublicIdentitySignalKind;
}

export function canonicalIdentitySignal(input: {
  locationIds: string[];
  organizationId: string;
  roleFamily: string;
  subjects: string[];
  title: string;
}): Promise<PublicIdentitySignal> {
  return signal("canonical_identity_v1", {
    locationIds: identifierSet(input.locationIds),
    organizationId: normalizeIdentifier(input.organizationId),
    roleFamily: input.roleFamily,
    subjects: normalizedSet(input.subjects),
    title: normalizeIdentityText(input.title),
  });
}

export function materialCloneSignal(
  materialHash: string
): Promise<PublicIdentitySignal> {
  return signal("material_clone_v1", { materialHash });
}

export function sourceReferenceSignal(input: {
  sourceKey: string;
  sourceReference: string;
}): Promise<PublicIdentitySignal> {
  return signal("source_reference_v1", {
    sourceKey: normalizeIdentifier(input.sourceKey),
    sourceReference: normalizeIdentifier(input.sourceReference),
  });
}

function normalizedSet(values: string[]) {
  return [...new Set(values.map(normalizeIdentityText).filter(Boolean))].sort();
}

function identifierSet(values: string[]) {
  return [...new Set(values.map(normalizeIdentifier).filter(Boolean))].sort();
}

function normalizeIdentifier(value: string) {
  return value.normalize("NFKC").trim();
}

async function signal(
  kind: PublicIdentitySignalKind,
  payload: Record<string, string | string[]>
): Promise<PublicIdentitySignal> {
  const hash = await sha256(
    `${IDENTITY_SIGNAL_NAMESPACE}\0${kind}\0${JSON.stringify(payload)}`
  );
  return { hash, kind };
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
