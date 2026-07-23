import { createFileRoute } from "@tanstack/react-router";
import {
  foundationHead,
  PublicFoundationPage,
} from "@/features/public/foundation-page";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () =>
    foundationHead(
      "Privacy | JobKit",
      "The public facts JobKit publishes and the candidate data it keeps private.",
      "/privacy"
    ),
});

function PrivacyPage() {
  return (
    <PublicFoundationPage
      introduction="Public discovery and private application work use separate data boundaries."
      sections={[
        {
          body: "Public job pages contain opportunity facts, canonical organization and location data, provenance, freshness, and a normalized description. Public output excludes recipient email addresses and telephone numbers.",
          title: "Public job data",
        },
        {
          body: "Profiles, preferences, documents, message foundations, drafts, recipients, application attempts, Gmail state, replies, and campaign execution remain inside the signed-in workspace.",
          title: "Candidate data",
        },
        {
          body: "Google OAuth grants the access required for the mailbox features a candidate enables. JobKit uses that access for the application and reply workflow and stores the corresponding private execution state.",
          title: "Connected accounts",
        },
        {
          body: "A signed-in candidate requests correction or deletion of their data from the account area of the JobKit workspace. Deletion removes candidate-owned records while public job facts remain published.",
          title: "Requests",
        },
      ]}
      title="Privacy"
    >
      Privacy
    </PublicFoundationPage>
  );
}
