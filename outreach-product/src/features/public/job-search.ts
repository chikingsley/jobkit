import { z } from "zod";

const stringSearchValue = z
  .preprocess(firstSearchValue, z.string().optional())
  .catch(undefined);

const publicJobSort = z
  .preprocess(
    firstSearchValue,
    z.enum(["relevance", "recent", "hourlyUsd", "title"]).optional()
  )
  .catch(undefined);

const publicJobWorkplace = z
  .preprocess(
    firstSearchValue,
    z.enum(["onsite", "hybrid", "remote"]).optional()
  )
  .catch(undefined);

const publicJobEmploymentType = z
  .preprocess(
    firstSearchValue,
    z.enum(["fullTime", "partTime", "contract"]).optional()
  )
  .catch(undefined);

const publicJobCompensation = z
  .preprocess(firstSearchValue, z.enum(["stated", "negotiable"]).optional())
  .catch(undefined);

const publicJobLimit = z
  .preprocess((value) => {
    const firstValue = firstSearchValue(value);
    if (typeof firstValue === "number" && Number.isFinite(firstValue)) {
      return String(firstValue);
    }
    return firstValue;
  }, z.string().optional())
  .catch(undefined);

/**
 * Owns the browser-facing shape of the public job URL. Exact normalization,
 * length errors, cursor verification, defaults, and market scope stay in the
 * server-side public-job query contract.
 */
export const publicJobsSearchSchema = z
  .object({
    compensation: publicJobCompensation,
    country: stringSearchValue,
    cursor: stringSearchValue,
    employmentType: publicJobEmploymentType,
    limit: publicJobLimit,
    q: stringSearchValue,
    sort: publicJobSort,
    workplace: publicJobWorkplace,
  })
  .strip()
  .catch({});

export type PublicJobsSearch = z.infer<typeof publicJobsSearchSchema>;

export function publicJobsSearchParameters(search: PublicJobsSearch) {
  const parameters = new URLSearchParams();
  append(parameters, "q", search.q);
  append(parameters, "country", search.country);
  append(parameters, "workplace", search.workplace);
  append(parameters, "employmentType", search.employmentType);
  append(parameters, "compensation", search.compensation);
  append(parameters, "sort", search.sort);
  append(parameters, "limit", search.limit);
  append(parameters, "cursor", search.cursor);
  return parameters;
}

function firstSearchValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function append(
  parameters: URLSearchParams,
  name: string,
  value: string | undefined
) {
  if (value !== undefined) {
    parameters.set(name, value);
  }
}
