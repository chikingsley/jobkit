import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CountryDetail,
  CountryMarketSummary,
} from "@/features/countries/types";
import { apiJson } from "@/lib/api";

export const countriesKeys = {
  all: ["countries"] as const,
  detail: (countryCode: string) =>
    ["countries", "detail", countryCode] as const,
  markets: ["countries", "markets"] as const,
};

export function useCountryMarkets() {
  return useQuery({
    queryFn: async () =>
      (await apiJson<{ countries: CountryMarketSummary[] }>("/api/countries"))
        .countries,
    queryKey: countriesKeys.markets,
  });
}

export function useCountryDetail(countryCode: string) {
  return useQuery({
    enabled: countryCode !== "",
    queryFn: async () =>
      (
        await apiJson<{ country: CountryDetail }>(
          `/api/countries/${countryCode}`
        )
      ).country,
    queryKey: countriesKeys.detail(countryCode),
  });
}

export function useQueueCountrySweep(countryCode: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cities: string[]) =>
      apiJson<{ message?: string }>(`/api/countries/${countryCode}/sweeps`, {
        body: JSON.stringify({
          cities,
          includeDirectories: true,
          includeKnownSources: true,
          includeMaps: true,
          includeSearch: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: countriesKeys.detail(countryCode),
      });
    },
  });
}
