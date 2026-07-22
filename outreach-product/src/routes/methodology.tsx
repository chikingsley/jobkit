import { createFileRoute } from "@tanstack/react-router";
import {
  foundationHead,
  PublicFoundationPage,
} from "@/features/public/foundation-page";

export const Route = createFileRoute("/methodology")({
  component: MethodologyPage,
  head: () =>
    foundationHead(
      "Methodology | JobKit",
      "How JobKit separates source facts, normalized records, analysis, and application outcomes."
    ),
});

function MethodologyPage() {
  return (
    <PublicFoundationPage title="Methodology">
      JobKit keeps literal source records, canonical facts, versioned analysis,
      and candidate execution history as separate layers. The complete public
      methodology will ship with the verified catalog.
    </PublicFoundationPage>
  );
}
