import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type MessageStyleChoice,
  type MessageStyleChoices,
  messageStyleComparisons,
} from "@/features/message-style/calibration";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function MessageStyleView({ request }: { request: ApiRequest }) {
  const [choices, setChoices] = useState<MessageStyleChoices>({});
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const comparison = messageStyleComparisons[index];
  const answered = Object.keys(choices).length;

  useEffect(() => {
    void request("/api/message-style")
      .then(async (response) => {
        const data = (await response.json()) as {
          choices: MessageStyleChoices;
        };
        setChoices(data.choices);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Writing preferences could not load"
        )
      );
  }, [request]);

  if (!comparison) {
    return null;
  }
  const selectedComparison = comparison;

  async function choose(choice: MessageStyleChoice) {
    setSaving(true);
    try {
      await request("/api/message-style", {
        body: JSON.stringify({
          choice,
          comparisonId: selectedComparison.id,
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      setChoices((current) => ({
        ...current,
        [selectedComparison.id]: choice,
      }));
      if (index < messageStyleComparisons.length - 1) {
        setIndex((current) => current + 1);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Writing preference could not be saved"
      );
    } finally {
      setSaving(false);
    }
  }

  const currentChoice = choices[selectedComparison.id];
  return (
    <SettingsPage
      description="Choose between real message patterns. Platform rules such as Hello, truthfulness, and one useful question never change."
      title="Writing style"
    >
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">
              {index + 1} of {messageStyleComparisons.length}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {answered} calibrated
            </span>
          </div>
          <CardTitle className="pt-2 text-xl">
            {selectedComparison.prompt}
          </CardTitle>
          <CardDescription>
            Pick the version you would rather send. You can revisit every
            answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <StyleOption
            active={currentChoice === "a"}
            example={selectedComparison.optionA.example}
            label={selectedComparison.optionA.label}
            onClick={() => void choose("a")}
          />
          <StyleOption
            active={currentChoice === "b"}
            example={selectedComparison.optionB.example}
            label={selectedComparison.optionB.label}
            onClick={() => void choose("b")}
          />
          <Button
            className="sm:col-span-2"
            disabled={saving}
            onClick={() => void choose("equal")}
            variant={currentChoice === "equal" ? "secondary" : "outline"}
          >
            {currentChoice === "equal" ? <Check /> : null}
            Both are fine
          </Button>
        </CardContent>
        <CardFooter className="justify-between border-t">
          <Button
            disabled={index === 0 || saving}
            onClick={() => setIndex((current) => current - 1)}
            variant="ghost"
          >
            <ArrowLeft /> Previous
          </Button>
          <Button
            disabled={index === messageStyleComparisons.length - 1 || saving}
            onClick={() => setIndex((current) => current + 1)}
            variant="ghost"
          >
            Next <ArrowRight />
          </Button>
        </CardFooter>
      </Card>
    </SettingsPage>
  );
}

function StyleOption({
  active,
  example,
  label,
  onClick,
}: {
  active: boolean;
  example: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "grid min-h-40 gap-4 rounded-xl border bg-background p-5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-primary bg-primary/5 ring-1 ring-primary"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center justify-between gap-3 font-medium">
        {label}
        {active ? <Check className="size-4 text-primary" /> : null}
      </span>
      <span className="text-foreground/75 text-sm leading-6">{example}</span>
    </button>
  );
}
