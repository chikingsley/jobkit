import { RefreshCw } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JobSort } from "@/features/jobs/sorting";
import { cn } from "@/lib/utils";

const fitFilterOptions = [
  { label: "All fits", value: "all" },
  { label: "Strong match", value: "Strong match" },
  { label: "Likely match", value: "Likely match" },
  { label: "Needs verification", value: "Needs verification" },
  { label: "Preference mismatch", value: "Preference mismatch" },
  { label: "Ineligible", value: "Ineligible" },
];

const sortOptions = [
  { label: "USD/hour", value: "stated-hourly" },
  { label: "Monthly USD", value: "monthly-pay" },
  { label: "Best match", value: "match-score" },
  { label: "Queue order", value: "review-order" },
];

export function JobToolbar({
  countries,
  countryFilter,
  fitFilter,
  onCountryFilter,
  onFitFilter,
  onRefresh,
  onShowExcluded,
  onSort,
  refreshing,
  showExcluded,
  sort,
}: {
  countries: string[];
  countryFilter: string;
  fitFilter: string;
  onCountryFilter: (value: string) => void;
  onFitFilter: (value: string) => void;
  onRefresh: () => Promise<void>;
  onShowExcluded: (value: boolean) => void;
  onSort: (value: JobSort) => void;
  refreshing: boolean;
  showExcluded: boolean;
  sort: JobSort;
}) {
  const blockedId = useId();
  const countryOptions = [
    { label: "All countries", value: "all" },
    ...countries.map((country) => ({ label: country, value: country })),
  ];
  return (
    <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:flex md:items-center">
      <FilterSelect
        ariaLabel="Filter jobs by fit"
        className="w-full md:w-36"
        items={fitFilterOptions}
        onValueChange={onFitFilter}
        value={fitFilter}
      />
      <FilterSelect
        ariaLabel="Filter jobs by country"
        className="w-full md:w-36"
        items={countryOptions}
        onValueChange={onCountryFilter}
        value={countryFilter}
      />
      <FilterSelect
        ariaLabel="Sort jobs"
        className="w-full md:w-36"
        items={sortOptions}
        onValueChange={(value) => onSort(value as JobSort)}
        value={sort}
      />
      <div className="flex min-w-0 items-center justify-between gap-2 md:shrink-0 md:justify-start">
        <label
          className="flex min-h-11 items-center gap-1.5 text-muted-foreground text-xs md:min-h-0"
          htmlFor={blockedId}
        >
          <Checkbox
            aria-label="Show jobs with hard blockers"
            checked={showExcluded}
            id={blockedId}
            onCheckedChange={(value) => onShowExcluded(Boolean(value))}
          />
          Blocked
        </label>
        <Button
          aria-label="Refresh jobs"
          className="shrink-0"
          onClick={() => void onRefresh()}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  ariaLabel,
  className,
  items,
  onValueChange,
  value,
}: {
  ariaLabel: string;
  className: string;
  items: Array<{ label: string; value: string }>;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <Select
      items={items}
      onValueChange={(nextValue) => onValueChange(String(nextValue))}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn("shrink-0", className)}
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
