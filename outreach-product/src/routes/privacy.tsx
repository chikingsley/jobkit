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
      "JobKit's public and candidate data boundaries."
    ),
});

function PrivacyPage() {
  return (
    <PublicFoundationPage title="Privacy">
      Public pages contain opportunity facts. Candidate profiles, documents,
      drafts, recipients, Gmail state, and execution records remain private.
    </PublicFoundationPage>
  );
}
