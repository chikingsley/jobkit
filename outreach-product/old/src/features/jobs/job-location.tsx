import { MapPin } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ResolvedJobLocation } from "@/features/jobs/types";

export function JobLocation({
  jobId,
  label,
  location,
}: {
  jobId: string;
  label: string;
  location?: ResolvedJobLocation;
}) {
  if (!location) {
    return (
      <div className="flex min-h-20 gap-3 rounded-xl bg-muted/35 p-3 ring-1 ring-foreground/10">
        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <LocationCopy label={label} />
      </div>
    );
  }
  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            className="flex min-h-20 w-full gap-3 rounded-xl bg-muted/35 p-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          />
        }
      >
        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <LocationCopy label={location.displayName || label} verified />
      </SheetTrigger>
      <SheetContent className="w-[min(44rem,calc(100vw-1rem))] sm:max-w-2xl">
        <SheetHeader className="pr-12">
          <SheetTitle>{location.displayName}</SheetTitle>
          <SheetDescription>
            Location resolved through Mapbox from the listing evidence.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <img
            alt={`Map centered on ${location.displayName}`}
            className="aspect-[8/5] w-full rounded-xl object-cover ring-1 ring-foreground/10"
            height={500}
            src={`/api/jobs/${encodeURIComponent(jobId)}/map`}
            width={800}
          />
          <p className="mt-3 text-muted-foreground text-xs">
            {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)} ·
            Mapbox
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LocationCopy({
  label,
  verified = false,
}: {
  label: string;
  verified?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block font-medium text-muted-foreground text-xs">
        Location
      </span>
      <span className="mt-1 block text-sm leading-5">{label}</span>
      {verified ? (
        <span className="mt-1 block text-primary text-xs">
          Mapbox verified · View map
        </span>
      ) : null}
    </span>
  );
}
