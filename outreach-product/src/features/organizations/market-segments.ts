import { z } from "zod";

export const OrganizationMarketSegmentSchema = z.enum([
  "international_school",
  "kindergarten",
  "language_center",
  "private_school",
  "public_school",
  "school",
  "training_center",
  "university",
]);

export const JobMarketSegmentSchema = z.enum([
  ...OrganizationMarketSegmentSchema.options,
  "online",
]);

export type JobMarketSegment = z.infer<typeof JobMarketSegmentSchema>;
export type OrganizationMarketSegment = z.infer<
  typeof OrganizationMarketSegmentSchema
>;

export const marketSegmentLabels: Record<JobMarketSegment, string> = {
  international_school: "International school",
  kindergarten: "Kindergarten",
  language_center: "Language center",
  online: "Online",
  private_school: "Private school",
  public_school: "Public school",
  school: "School",
  training_center: "Training center",
  university: "University",
};

export const restrictedMarketSegments = new Set<JobMarketSegment>([
  "language_center",
  "training_center",
]);
