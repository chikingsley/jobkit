import { describe, expect, it } from "bun:test";
import { extractAjarnFacts } from "../../src/pipeline/02_extract/ajarn-fields";
import {
  extractEslCafeFacts,
  positionsInPost,
} from "../../src/pipeline/02_extract/eslcafe-fields";
import { extractTeflFacts } from "../../src/pipeline/02_extract/tefl-fields";

describe("ajarn salary line", () => {
  it("reads the amount, currency and period the board prints", () => {
    expect(
      extractAjarnFacts({
        source_salary: "At least ฿92,500 / month (full time)",
      }).compensation
    ).toMatchObject({
      amountMinimum: 92_500,
      currency: "THB",
      period: "month",
      qualifier: "from",
    });
  });

  it("records the employment type stated in the same line", () => {
    expect(
      extractAjarnFacts({
        source_salary: "At least ฿40,000 / month (full time)",
      }).employmentTypes
    ).toEqual([
      {
        evidence: "At least ฿40,000 / month (full time)",
        value: "fullTime",
      },
    ]);
    expect(
      extractAjarnFacts({ source_salary: "฿500 / hour (part time)" })
        .employmentTypes[0]?.value
    ).toBe("partTime");
  });

  it("keeps an hourly rate hourly", () => {
    expect(
      extractAjarnFacts({ source_salary: "฿600 / hour (part time)" })
        .compensation
    ).toMatchObject({ amountMinimum: 600, currency: "THB", period: "hour" });
  });

  it("records nothing when the board printed no salary", () => {
    expect(extractAjarnFacts({}).compensation).toBeNull();
    expect(extractAjarnFacts({ source_salary: "Negotiable" })).toEqual({
      compensation: null,
      employmentTypes: [],
    });
  });
});

describe("eslcafe posts that advertise many schools at once", () => {
  it("counts how many positions one post carries", () => {
    expect(positionsInPost("Salary 2.5 million KRW monthly")).toBe(1);
    expect(
      positionsInPost("Salary 2.5 million KRW monthly ... Salary 2.4 million")
    ).toBe(2);
    expect(positionsInPost("no pay stated here")).toBe(0);
  });

  it("refuses to pick one salary out of an agency digest", () => {
    const digest =
      "Poly Gwangju Location Nam-gu Salary Starting from 2.5 million KRW monthly Hansol YBM Location Gyeonggi Salary Starting from 2.4 million KRW monthly";
    const extracted = extractEslCafeFacts({ body: digest });
    expect(extracted.positionsInPost).toBe(2);
    expect(extracted.compensation).toBeNull();
  });

  it("reads a single stated salary with its period", () => {
    expect(
      extractEslCafeFacts({
        body: "Student Type Kindergarten & Elementary Salary: ₩3.2 million per month Benefits housing",
      }).compensation
    ).toMatchObject({
      amountMinimum: 3_200_000,
      currency: "KRW",
      period: "month",
    });
  });

  it("prefers a stated currency code over the dollar sign beside it", () => {
    expect(
      extractEslCafeFacts({
        body: "Salary & Benefits Pay NTD $600 – $730 per hour",
      }).compensation
    ).toMatchObject({ currency: "TWD", period: "hour" });
  });

  it("refuses a word whose first letters look like a currency code", () => {
    expect(
      extractEslCafeFacts({
        body: "SALARY & BENEFITS — OVERSEAS HIRE 2026 monthly",
      }).compensation
    ).toBeNull();
    expect(
      extractEslCafeFacts({ body: "Salary EMPLOYMENT 1 per month" })
        .compensation
    ).toBeNull();
  });

  it("derives the learner group from the stated student type", () => {
    expect(
      extractEslCafeFacts({
        body: "Student Type Kindergarten & Elementary Salary none",
      }).audiences.map((entry) => entry.value)
    ).toEqual(["preschool", "primary"]);
  });
});

describe("tefl structured posting", () => {
  const posting = JSON.stringify({
    "@type": "JobPosting",
    description:
      "<h3>Job Summary</h3>We are accepting applications for our Young Learners English Program and Secondary School English Program.",
    hiringOrganization: { name: "Nagoya International School" },
    jobLocation: {
      address: { addressCountry: "Japan", addressLocality: "Nagoya" },
    },
    title: "English Teacher",
  });

  it("reads the country and locality the posting declares", () => {
    const extracted = extractTeflFacts({ job_posting_json_ld: posting });
    expect(extracted.posting?.country).toBe("Japan");
    expect(extracted.posting?.locality).toBe("Nagoya");
    expect(extracted.posting?.organisation).toBe("Nagoya International School");
  });

  it("strips the markup the description carries", () => {
    expect(
      extractTeflFacts({ job_posting_json_ld: posting }).posting?.description
    ).not.toContain("<h3>");
  });

  it("derives learner groups and segment from the description", () => {
    const extracted = extractTeflFacts({ job_posting_json_ld: posting });
    expect(extracted.audiences.map((entry) => entry.value)).toEqual([
      "preschool",
      "teenagers",
    ]);
    expect(extracted.marketSegments.map((entry) => entry.value)).toContain(
      "international_school"
    );
  });

  it("records nothing when the posting is absent or unreadable", () => {
    expect(extractTeflFacts({}).posting).toBeNull();
    expect(
      extractTeflFacts({ job_posting_json_ld: "not json" }).posting
    ).toBeNull();
  });
});
