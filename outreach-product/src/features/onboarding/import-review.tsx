import { Card, CardContent } from "@/components/ui/card";
import type { ProfileImportProposal } from "@/features/onboarding/schema";

export function ImportReview({
  proposal,
}: {
  proposal: ProfileImportProposal;
}) {
  const lowConfidence = [
    proposal.citizenship,
    proposal.currentLocation,
    proposal.email,
    proposal.experienceLabel,
    proposal.fullName,
    proposal.introduction,
    proposal.phone,
    ...proposal.credentials,
    ...proposal.education,
    ...proposal.languages,
    ...proposal.skills,
    ...proposal.workExperience,
  ].filter((item) => item.confidence === "low").length;
  const facts =
    proposal.credentials.length +
    proposal.education.length +
    proposal.languages.length +
    proposal.skills.length +
    proposal.workExperience.length;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6">
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="font-medium">Review the imported facts</p>
            <p className="mt-1 text-muted-foreground text-sm">
              JobKit found {facts} structured items. Every imported item was
              checked against a direct source quote; confirm anything marked for
              review below.
            </p>
            {proposal.reviewNotes.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
                {proposal.reviewNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 text-center">
            <div className="font-semibold text-lg">{lowConfidence}</div>
            <div className="text-muted-foreground text-xs">
              low-confidence items
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
