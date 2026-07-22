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
      "JobKit's correction process is being prepared with the public catalog."
    ),
});

function CorrectionsPage() {
  return (
    <PublicFoundationPage title="Corrections">
      The public correction channel will open with the verified job catalog.
    </PublicFoundationPage>
  );
}
