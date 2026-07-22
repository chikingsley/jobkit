import { findPhoneNumbersInText } from "libphonenumber-js";
import type { JobContentAnalysis } from "../jobs/content-analysis";
import type { JobPositionVariant } from "../jobs/position-variants";
import type { JobMatchFacts } from "../matching/schema";

export const PUBLIC_DESCRIPTION_CONTRACT_VERSION = "public-description-v1";

interface DescriptionSection {
  heading: string;
  items: string[];
  kind: "list" | "paragraphs";
}

export interface PublicDescription {
  canonicalJson: string;
  html: string;
  redactedItems: string[];
  sections: DescriptionSection[];
}

const contactPattern =
  /(?:\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:https?:\/\/|www\.)\S+|\b(?:mailto|tel):\S+)/iu;

const benefitLabels: Record<
  JobMatchFacts["benefits"][number]["value"],
  string
> = {
  airfare: "Airfare support",
  healthInsurance: "Health insurance",
  housing: "Housing",
  paidLeave: "Paid leave",
  professionalDevelopment: "Professional development",
  visaSponsorship: "Visa sponsorship",
};

const benefitLevelLabels: Record<
  JobMatchFacts["benefits"][number]["level"],
  string
> = {
  allowance: "allowance",
  assistance: "assistance",
  provided: "provided",
};

export function buildPublicDescription(input: {
  analysis: JobContentAnalysis;
  facts: JobMatchFacts;
  position: JobPositionVariant;
}): PublicDescription {
  const redactedItems: string[] = [];
  const safe = (values: string[]) =>
    uniqueText(
      values.flatMap((value) => {
        const normalized = normalizeVisibleText(value);
        if (!(normalized && containsPrivateContactValue(normalized))) {
          return normalized ? [normalized] : [];
        }
        redactedItems.push(normalized);
        return [];
      })
    );
  const requirements =
    input.position.requirements.length > 0
      ? input.position.requirements
      : input.facts.requirements;
  const sections = [
    section(
      "Overview",
      "paragraphs",
      safe(input.analysis.overview.map(({ text }) => text))
    ),
    section(
      "Responsibilities",
      "list",
      safe(input.analysis.responsibilities.map(({ text }) => text))
    ),
    section(
      "Qualifications",
      "list",
      safe(requirements.map(({ label }) => label))
    ),
    section(
      "Teaching context",
      "list",
      safe([
        ...input.analysis.teachingContext.map(factLabel),
        ...input.facts.audiences.map(({ value }) => audienceLabel(value)),
      ])
    ),
    section(
      "Schedule and contract",
      "list",
      safe(input.analysis.scheduleAndContract.map(factLabel))
    ),
    section(
      "Compensation and benefits",
      "list",
      safe([
        ...compensationLabels(input.facts),
        ...input.facts.benefits
          .filter(({ value }) => value !== "visaSponsorship")
          .map(
            ({ level, value }) =>
              `${benefitLabels[value]}: ${benefitLevelLabels[level]}`
          ),
      ])
    ),
    section(
      "Location and visa",
      "list",
      safe([
        ...input.position.locations.map(({ value }) => value),
        ...input.facts.benefits
          .filter(({ value }) => value === "visaSponsorship")
          .map(({ level }) => `Visa sponsorship: ${benefitLevelLabels[level]}`),
      ])
    ),
    section(
      "Application process",
      "list",
      safe(input.analysis.applicationProcess.map(({ text }) => text))
    ),
    section(
      "Additional details",
      "list",
      safe(
        input.analysis.additionalSections.flatMap(({ items, title }) =>
          items.map(({ text }) => `${title}: ${text}`)
        )
      )
    ),
  ].filter((value): value is DescriptionSection => value !== null);

  const canonicalJson = JSON.stringify({
    contractVersion: PUBLIC_DESCRIPTION_CONTRACT_VERSION,
    sections,
  });
  return {
    canonicalJson,
    html: sections.map(renderSection).join(""),
    redactedItems: uniqueText(redactedItems),
    sections,
  };
}

export function containsPrivateContactValue(value: string) {
  if (contactPattern.test(value)) {
    return true;
  }
  return findPhoneNumbersInText(value, "US").some(({ number }) =>
    number.isPossible()
  );
}

function section(
  heading: string,
  kind: DescriptionSection["kind"],
  items: string[]
): DescriptionSection | null {
  return items.length > 0 ? { heading, items, kind } : null;
}

function renderSection(value: DescriptionSection) {
  const body =
    value.kind === "paragraphs"
      ? value.items.map((item) => `<p>${escapeHtml(item)}</p>`).join("")
      : `<ul>${value.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`;
  return `<section><h2>${escapeHtml(value.heading)}</h2>${body}</section>`;
}

function factLabel(value: { label: string; value: string }) {
  return `${value.label}: ${value.value}`;
}

function audienceLabel(value: JobMatchFacts["audiences"][number]["value"]) {
  const labels: Record<typeof value, string> = {
    adults: "Adult learners",
    college: "College or university learners",
    preschool: "Preschool learners",
    primary: "Primary-age learners",
    teenagers: "Teenage learners",
  };
  return labels[value];
}

function compensationLabels(facts: JobMatchFacts) {
  const { compensation } = facts.economics;
  if (compensation.kind === "negotiable") {
    return ["Compensation is negotiable"];
  }
  if (compensation.kind !== "amount" || !compensation.currency) {
    return [];
  }
  const minimum = compensation.amountMinimum;
  const maximum = compensation.amountMaximum;
  const amount =
    minimum !== null && maximum !== null && minimum !== maximum
      ? `${formatNumber(minimum)}–${formatNumber(maximum)}`
      : formatNumber(minimum ?? maximum ?? 0);
  const period = compensation.period ? ` per ${compensation.period}` : "";
  const tax =
    compensation.taxBasis === "unspecified"
      ? ""
      : ` (${compensation.taxBasis})`;
  return [`${compensation.currency} ${amount}${period}${tax}`];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value
  );
}

function normalizeVisibleText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function uniqueText(values: string[]) {
  return [...new Set(values)];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
