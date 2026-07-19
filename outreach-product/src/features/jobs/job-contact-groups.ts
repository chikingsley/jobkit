import type { ContactSummary, Job } from "./types";

export interface JobContactGroup {
  contact: ContactSummary | null;
  id: string;
  jobs: Job[];
}

function activeEmailContact(job: Job) {
  return job.applicationRoutes.find(
    (route) => route.kind === "email" && route.status === "active"
  )?.contact;
}

export function groupJobsByContact(jobs: Job[]): JobContactGroup[] {
  const groups = new Map<string, JobContactGroup>();
  for (const job of jobs) {
    const contact = activeEmailContact(job) ?? null;
    const canCollapse = contact && contact.role !== "board_intermediary";
    const key = canCollapse ? `contact:${contact.id}` : `job:${job.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
      continue;
    }
    groups.set(key, { contact, id: key, jobs: [job] });
  }
  return [...groups.values()];
}
