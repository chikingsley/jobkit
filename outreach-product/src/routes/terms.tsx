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
      "JobKit's full terms will accompany public launch."
    ),
});

function TermsPage() {
  return (
    <PublicFoundationPage title="Terms">
      Full product terms will accompany the public catalog and application
      service.
    </PublicFoundationPage>
  );
}
