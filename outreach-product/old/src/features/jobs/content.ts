const DESCRIPTION_HEADING_PATTERN =
  /\s+(?=(?:Required Degrees|Fields of Expertise|Details|Minimum Requirements|Key Responsibilities|What We Offer|Your Role|Job Benefits|Salary and benefits)\s*:)/gi;
const DESCRIPTION_BULLET_PATTERN = /\s+(?=[•■])/g;

export function formatDescription(value: string) {
  return value
    .replace(DESCRIPTION_HEADING_PATTERN, "\n\n")
    .replace(DESCRIPTION_BULLET_PATTERN, "\n")
    .trim();
}
