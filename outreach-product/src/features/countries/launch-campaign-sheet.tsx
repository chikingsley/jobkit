import { Rocket } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  CampaignExecutionMode,
  CountryCampaignLaunch,
} from "@/features/countries/schema";
import type { ApiRequest } from "@/lib/api";

const executionOptions: Array<{
  description: string;
  label: string;
  value: CampaignExecutionMode;
}> = [
  {
    description:
      "Refresh the school catalog and save the results without preparing messages.",
    label: "Research only",
    value: "research_only",
  },
  {
    description: "Prepare targets and keep every message in the review queue.",
    label: "Review every message",
    value: "review_each",
  },
  {
    description:
      "Use the saved channel rules, limits, exclusions, and match threshold.",
    label: "Use automation policy",
    value: "use_automation",
  },
];

export function LaunchCampaignSheet({
  countryCode,
  countryName,
  onLaunched,
  request,
}: {
  countryCode: string;
  countryName: string;
  onLaunched: () => Promise<unknown>;
  request: ApiRequest;
}) {
  const [open, setOpen] = useState(false);
  const [launch, setLaunch] = useState<CountryCampaignLaunch>({
    executionMode: "review_each",
    includeOpenPositions: true,
    includeSchoolOutreach: true,
  });
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const positionsId = `${groupId}-positions`;
  const schoolsId = `${groupId}-schools`;
  const canLaunch = launch.includeOpenPositions || launch.includeSchoolOutreach;

  async function submit() {
    setBusy(true);
    try {
      const response = await request(
        `/api/countries/${countryCode}/campaigns`,
        {
          body: JSON.stringify(launch),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      const result = (await response.json()) as { message?: string };
      await onLaunched();
      setOpen(false);
      toast.success(result.message ?? "Campaign launched");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Campaign could not launch"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger render={<Button />}>
        <Rocket /> Launch campaign
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Launch {countryName}</SheetTitle>
          <SheetDescription>
            Choose what to include and how every resulting message is handled.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 overflow-y-auto px-4">
          <Field>
            <FieldLabel>Include</FieldLabel>
            <label
              className="flex items-start gap-3 rounded-lg border p-3"
              htmlFor={positionsId}
            >
              <Checkbox
                checked={launch.includeOpenPositions}
                id={positionsId}
                onCheckedChange={(checked) =>
                  setLaunch({ ...launch, includeOpenPositions: checked })
                }
              />
              <span>
                <span className="block font-medium">Open positions</span>
                <span className="text-muted-foreground text-sm">
                  Current listings with an application route.
                </span>
              </span>
            </label>
            <label
              className="flex items-start gap-3 rounded-lg border p-3"
              htmlFor={schoolsId}
            >
              <Checkbox
                checked={launch.includeSchoolOutreach}
                id={schoolsId}
                onCheckedChange={(checked) =>
                  setLaunch({ ...launch, includeSchoolOutreach: checked })
                }
              />
              <span>
                <span className="block font-medium">School outreach</span>
                <span className="text-muted-foreground text-sm">
                  Refresh schools and verified contact points in this country.
                </span>
              </span>
            </label>
            {canLaunch ? null : (
              <FieldDescription className="text-destructive">
                Choose at least one source.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel>Execution</FieldLabel>
            <RadioGroup
              onValueChange={(value) => {
                if (
                  value === "research_only" ||
                  value === "review_each" ||
                  value === "use_automation"
                ) {
                  setLaunch({ ...launch, executionMode: value });
                }
              }}
              value={launch.executionMode}
            >
              {executionOptions.map((option) => (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
                  htmlFor={`${groupId}-${option.value}`}
                  key={option.value}
                >
                  <RadioGroupItem
                    id={`${groupId}-${option.value}`}
                    value={option.value}
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-muted-foreground text-sm">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Field>
        </div>
        <SheetFooter className="border-t">
          <Button disabled={!canLaunch || busy} onClick={() => void submit()}>
            <Rocket /> {busy ? "Launching…" : "Launch campaign"}
          </Button>
          <Button onClick={() => setOpen(false)} variant="outline">
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
