import { createFileRoute } from "@tanstack/react-router";
import { CountryView } from "@/features/countries/country-view";
import { WorkspacePage } from "@/features/workspace/shell";

export const Route = createFileRoute("/app/campaigns/markets/$countryCode")({
  component: CountryRoute,
});

function CountryRoute() {
  const { countryCode } = Route.useParams();
  return (
    <WorkspacePage>
      <CountryView countryCode={countryCode} />
    </WorkspacePage>
  );
}
