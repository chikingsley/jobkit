import type { Job } from "./types";

const DESCRIPTION_HEADING_PATTERN =
  /\s+(?=(?:Required Degrees|Fields of Expertise|Details|Minimum Requirements|Key Responsibilities|What We Offer|Your Role|Job Benefits|Salary and benefits)\s*:)/gi;
const DESCRIPTION_BULLET_PATTERN = /\s+(?=[•■])/g;
const SCHEDULE_PATTERN =
  /(teaching hours|working hours|hours per week|monday|sunday|full-time|part-time)/i;
const START_DATE_PATTERN =
  /start date\s*:|immediate(?:ly)?(?: start| available| !)|\b(?:august|september|october|november|december|january|february|march|april|may|june|july)(?:\s+\d{1,2},?)?\s+20\d{2}\b/i;
const STUDENT_PATTERN =
  /(students|learners|children|adults|grades?|age[s ]|kindergarten|college)/i;

export function formatDescription(value: string) {
  return value
    .replace(DESCRIPTION_HEADING_PATTERN, "\n\n")
    .replace(DESCRIPTION_BULLET_PATTERN, "\n")
    .trim();
}

export function questionsFor(job: Job) {
  const source = `${job.title} ${job.description}`.toLowerCase();
  const questions: string[] = [];
  if (
    job.compensation.amountMin === null &&
    job.compensation.amountMax === null
  ) {
    questions.push(
      "What is the salary or expected salary range, and in which currency?"
    );
  } else if (job.compensation.currency === null) {
    questions.push(
      "Which currency applies to the listed salary or salary range?"
    );
  }
  if (!SCHEDULE_PATTERN.test(source)) {
    questions.push(
      "What is the expected weekly teaching and working schedule?"
    );
  }
  if (!START_DATE_PATTERN.test(job.description)) {
    questions.push("What is the anticipated start date?");
  }
  if (!STUDENT_PATTERN.test(source)) {
    questions.push(
      "Which student groups and proficiency levels would I teach?"
    );
  }
  return questions.length > 0
    ? questions
    : [
        "Are there any details that have changed since this listing was posted?",
      ];
}
