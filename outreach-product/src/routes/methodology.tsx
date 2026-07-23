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
      "How JobKit separates source facts, normalized records, analysis, and application outcomes.",
      "/methodology"
    ),
});

function MethodologyPage() {
  return (
    <PublicFoundationPage
      introduction="JobKit keeps the source, the normalized public record, private candidate analysis, and application execution as separate records."
      sections={[
        {
          body: "Collectors preserve the literal listing, its source URL, source dates, and material-change hash. Freshness checks can advance without silently rewriting that source record.",
          title: "Source record",
        },
        {
          body: "A public job represents one advertised position with a canonical organization, Mapbox-backed location, readable description, provenance, and an active application route.",
          title: "Canonical public record",
        },
        {
          body: "Requirements, position variants, compensation, and candidate fit are versioned analysis. Claims remain tied to source evidence, and ambiguity stays visible.",
          title: "Analysis",
        },
        {
          body: "Drafts, attachment packets, sends, replies, outcomes, and campaign pacing belong to the signed-in candidate. Public pages never contain those records.",
          title: "Application trail",
        },
      ]}
      title="Methodology"
    >
      Methodology
    </PublicFoundationPage>
  );
}
