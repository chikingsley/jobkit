import { z } from "zod";

const optionalSearchString = z
  .preprocess(
    (value) => (typeof value === "string" && value ? value : undefined),
    z.string().max(200).optional()
  )
  .catch(undefined);
const optionalSearchBoolean = z
  .preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (value === true || value === 1 || value === "1" || value === "true") {
      return true;
    }
    if (value === false || value === 0 || value === "0" || value === "false") {
      return false;
    }
    return value;
  }, z.boolean().optional())
  .catch(undefined);

export const jobsSearchSchema = z
  .object({
    country: z.string().max(100).optional().catch(undefined),
    detail: optionalSearchBoolean,
    excluded: optionalSearchBoolean,
    fit: z.string().max(100).optional().catch(undefined),
    job: optionalSearchString,
    publicJob: optionalSearchString,
    signup: optionalSearchBoolean,
    sort: z
      .enum(["monthly-pay", "review-order", "stated-hourly"])
      .optional()
      .catch(undefined),
  })
  .catch({});
export type JobsSearch = z.infer<typeof jobsSearchSchema>;

export const messagesSearchSchema = z
  .object({
    detail: optionalSearchBoolean,
    thread: optionalSearchString,
  })
  .catch({});
export type MessagesSearch = z.infer<typeof messagesSearchSchema>;

export const newCampaignSearchSchema = z
  .object({
    country: z
      .preprocess(
        (value) =>
          typeof value === "string" && value
            ? value.trim().toUpperCase()
            : undefined,
        z.string().max(3).optional()
      )
      .catch(undefined),
  })
  .catch({});

export const testLabSearchSchema = z
  .object({
    case: optionalSearchString,
    classification: optionalSearchString,
    tab: z
      .enum(["cases", "classification", "delivery", "documents", "runs"])
      .optional()
      .catch(undefined),
  })
  .catch({});
