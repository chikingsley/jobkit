import { createFileRoute } from "@tanstack/react-router";
import {
  foundationHead,
  PublicFoundationPage,
} from "@/features/public/foundation-page";

export const Route = createFileRoute("/corrections")({
  component: CorrectionsPage,
  head: () =>
    foundationHead(
      "Corrections | JobKit",
      "How to report an inaccurate, closed, duplicated, or privately exposed JobKit listing.",
      "/corrections"
    ),
});

function CorrectionsPage() {
  return (
    <PublicFoundationPage
      introduction="Job data changes. JobKit records corrections against the canonical job and its source evidence."
      sections={[
        {
          body: "Corrections come from signed-in candidates. Report the issue from your JobKit workspace with the canonical JobKit URL, the corrected fact, and a public source that supports the change.",
          title: "Report a correction",
        },
        {
          body: "Reports can cover a closed role, incorrect title, employer or location, duplicate position, invalid application route, or exposed private contact information.",
          title: "What to include",
        },
        {
          body: "A verified correction updates the current canonical record, preserves the prior version, and removes or redirects pages when the position has closed or merged.",
          title: "What happens next",
        },
      ]}
      title="Corrections"
    >
      Corrections
    </PublicFoundationPage>
  );
}
