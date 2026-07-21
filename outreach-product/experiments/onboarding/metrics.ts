import type { ProfileImportProposal } from "../../src/features/onboarding/schema";
import type {
  ProfileImportCaseResult,
  ProfileImportFixture,
} from "./contracts";

const TEACHING_EXPERIENCE_SUFFIX_PATTERN = / of teaching experience$/u;

interface ScoredProfileImport {
  error?: string;
  evidenceAccuracy: number;
  fixtureId: string;
  latencyMs: number;
  scalarAccuracy: number;
  structureAccuracy: number;
}

export function summarizeProfileImports(
  fixtures: ProfileImportFixture[],
  results: ProfileImportCaseResult[]
) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const scored: ScoredProfileImport[] = results.map((result) => {
    const fixture = fixtureById.get(result.fixtureId);
    if (!fixture) {
      throw new Error(`Unknown profile fixture ${result.fixtureId}`);
    }
    if (!result.proposal) {
      return {
        error: result.error ?? "No proposal",
        evidenceAccuracy: 0,
        fixtureId: result.fixtureId,
        latencyMs: result.latencyMs,
        scalarAccuracy: 0,
        structureAccuracy: 0,
      };
    }
    return scoreProposal(fixture, result.proposal, result.latencyMs);
  });
  const successful = scored.filter((item) => !item.error);
  return {
    cases: scored,
    failed: scored.length - successful.length,
    meanEvidenceAccuracy: mean(successful.map((item) => item.evidenceAccuracy)),
    meanLatencyMs: mean(successful.map((item) => item.latencyMs)),
    meanScalarAccuracy: mean(successful.map((item) => item.scalarAccuracy)),
    meanStructureAccuracy: mean(
      successful.map((item) => item.structureAccuracy)
    ),
    successful: successful.length,
    total: scored.length,
  };
}

function scoreProposal(
  fixture: ProfileImportFixture,
  proposal: ProfileImportProposal,
  latencyMs: number
) {
  const scalarChecks = [
    equivalent(proposal.fullName.value, fixture.expected.fullName),
    equivalent(proposal.email.value, fixture.expected.email),
    equivalent(proposal.phone.value, fixture.expected.phone),
    equivalent(
      proposal.currentLocation.value,
      fixture.expected.currentLocation
    ),
    equivalent(proposal.citizenship.value, fixture.expected.citizenship),
    equivalentExperienceLabel(
      proposal.experienceLabel.value,
      fixture.expected.experienceLabel
    ),
    equivalent(proposal.introduction.value, fixture.expected.introduction),
  ];
  const structureChecks = [
    setEqual(
      proposal.credentials.map((item) => item.value),
      fixture.expected.credentials
    ),
    setEqual(
      proposal.skills.map((item) => item.value),
      fixture.expected.skills
    ),
    setEqual(
      proposal.languages.map((item) => `${item.language}|${item.level}`),
      fixture.expected.languages.map((item) => `${item.language}|${item.level}`)
    ),
    setEqual(
      proposal.education.map(
        (item) =>
          `${item.institution}|${canonicalDegree(item.degree, item.field)}`
      ),
      fixture.expected.education.map(
        (item) =>
          `${item.institution}|${canonicalDegree(item.degree, item.field)}`
      )
    ),
    setEqual(
      proposal.workExperience.map((item) => `${item.employer}|${item.title}`),
      fixture.expected.workExperience.map(
        (item) => `${item.employer}|${item.title}`
      )
    ),
  ];
  const evidence = allEvidence(proposal);
  return {
    evidenceAccuracy: ratio(
      evidence.map(
        (item) => !item.value || fixture.resume.includes(item.evidence)
      )
    ),
    fixtureId: fixture.id,
    latencyMs,
    scalarAccuracy: ratio(scalarChecks),
    structureAccuracy: ratio(structureChecks),
  };
}

function allEvidence(proposal: ProfileImportProposal) {
  const scalars = [
    proposal.citizenship,
    proposal.currentLocation,
    proposal.email,
    proposal.experienceLabel,
    proposal.fullName,
    proposal.introduction,
    proposal.phone,
  ];
  return [
    ...scalars,
    ...proposal.credentials,
    ...proposal.education,
    ...proposal.languages,
    ...proposal.skills,
    ...proposal.workExperience,
  ].map((item) => ({
    evidence: item.evidence,
    value: "value" in item ? item.value : JSON.stringify(item),
  }));
}

function setEqual(left: string[], right: string[]) {
  const normalizedLeft = new Set(left.map(normalize));
  const normalizedRight = new Set(right.map(normalize));
  return (
    normalizedLeft.size === normalizedRight.size &&
    [...normalizedLeft].every((value) => normalizedRight.has(value))
  );
}

function canonicalDegree(degree: string, field: string) {
  const normalizedDegree = normalize(degree);
  const suffix = ` in ${normalize(field)}`;
  return field && normalizedDegree.endsWith(suffix)
    ? normalizedDegree.slice(0, -suffix.length)
    : normalizedDegree;
}

function equivalent(left: string, right: string) {
  return normalize(left) === normalize(right);
}

function equivalentExperienceLabel(left: string, right: string) {
  const canonical = (value: string) =>
    normalize(value).replace(TEACHING_EXPERIENCE_SUFFIX_PATTERN, "");
  return canonical(left) === canonical(right);
}

function normalize(value: string) {
  return value.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

function ratio(values: boolean[]) {
  return values.length > 0 ? values.filter(Boolean).length / values.length : 1;
}

function mean(values: number[]) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}
