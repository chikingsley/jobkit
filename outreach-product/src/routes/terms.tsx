import { createFileRoute } from "@tanstack/react-router";
import {
  foundationHead,
  PublicFoundationPage,
} from "@/features/public/foundation-page";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () =>
    foundationHead(
      "Terms | JobKit",
      "The terms for using JobKit job discovery and application tools.",
      "/terms"
    ),
});

function TermsPage() {
  return (
    <PublicFoundationPage
      introduction="JobKit helps candidates discover and apply to opportunities. Employers and source sites remain responsible for their own listings, hiring decisions, and terms."
      sections={[
        {
          body: "Verify compensation, hours, benefits, visa requirements, employer identity, and contract terms directly with the employer before accepting a role or providing sensitive documents.",
          title: "Candidate responsibility",
        },
        {
          body: "JobKit normalizes source-backed facts and records provenance. A listing can change, close, contain an error, or come from an unaffiliated third party.",
          title: "Listing accuracy",
        },
        {
          body: "Use application and campaign tools for genuine employment outreach. Respect provider rules, recipient choices, rate limits, and applicable anti-spam and privacy law.",
          title: "Acceptable use",
        },
        {
          body: "Source names and marks belong to their respective owners. JobKit-authored summaries identify their source while keeping source records and private contact destinations outside public output.",
          title: "Sources",
        },
      ]}
      title="Terms"
    >
      Terms
    </PublicFoundationPage>
  );
}
