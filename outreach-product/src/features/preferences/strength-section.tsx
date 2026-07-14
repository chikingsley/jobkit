import { useId } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BenefitStrength, RuleStrength } from "@/profile-types";

const preferenceStrengthOptions: Array<{
  activeClassName: string;
  label: string;
  value: RuleStrength;
}> = [
  {
    activeClassName:
      "has-data-checked:border-destructive has-data-checked:bg-destructive/10 has-data-checked:text-destructive",
    label: "Exclude",
    value: "exclude",
  },
  {
    activeClassName:
      "has-data-checked:border-amber-500 has-data-checked:bg-amber-500/10 has-data-checked:text-amber-800 dark:has-data-checked:text-amber-300",
    label: "Avoid",
    value: "avoid",
  },
  {
    activeClassName:
      "has-data-checked:border-foreground/30 has-data-checked:bg-muted has-data-checked:text-foreground",
    label: "Open",
    value: "accept",
  },
  {
    activeClassName:
      "has-data-checked:border-primary has-data-checked:bg-primary/10 has-data-checked:text-primary",
    label: "Prefer",
    value: "prefer",
  },
];

const benefitStrengthOptions: Array<{
  activeClassName: string;
  label: string;
  value: BenefitStrength;
}> = [
  {
    activeClassName:
      "has-data-checked:border-foreground/30 has-data-checked:bg-muted has-data-checked:text-foreground",
    label: "Optional",
    value: "accept",
  },
  {
    activeClassName:
      "has-data-checked:border-primary has-data-checked:bg-primary/10 has-data-checked:text-primary",
    label: "Preferred",
    value: "prefer",
  },
  {
    activeClassName:
      "has-data-checked:border-primary has-data-checked:bg-primary has-data-checked:text-primary-foreground",
    label: "Required",
    value: "required",
  },
];

export function PreferenceSection<Key extends string>({
  description,
  labels,
  onChange,
  title,
  values,
}: {
  description: string;
  labels: [Key, string][];
  onChange: (key: Key, value: RuleStrength) => void;
  title: string;
  values: Record<Key, RuleStrength>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-6 gap-y-5">
        {labels.map(([key, label]) => (
          <Field key={key}>
            <FieldLabel>{label}</FieldLabel>
            <PreferenceToggle
              onChange={(value) => onChange(key, value)}
              value={values[key] ?? "accept"}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  );
}

export function BenefitSection<Key extends string>({
  description,
  labels,
  onChange,
  title,
  values,
}: {
  description: string;
  labels: [Key, string][];
  onChange: (key: Key, value: BenefitStrength) => void;
  title: string;
  values: Record<Key, BenefitStrength>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-6 gap-y-5">
        {labels.map(([key, label]) => (
          <Field key={key}>
            <FieldLabel>{label}</FieldLabel>
            <BenefitToggle
              onChange={(value) => onChange(key, value)}
              value={values[key] ?? "accept"}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  );
}

function PreferenceToggle({
  onChange,
  value,
}: {
  onChange: (value: RuleStrength) => void;
  value: RuleStrength;
}) {
  return (
    <StrengthToggle
      label="Preference strength"
      onChange={onChange}
      options={preferenceStrengthOptions}
      value={value}
    />
  );
}

function BenefitToggle({
  onChange,
  value,
}: {
  onChange: (value: BenefitStrength) => void;
  value: BenefitStrength;
}) {
  return (
    <StrengthToggle
      label="Benefit importance"
      onChange={onChange}
      options={benefitStrengthOptions}
      value={value}
    />
  );
}

function StrengthToggle<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: Array<{
    activeClassName: string;
    label: string;
    value: Value;
  }>;
  value: Value;
}) {
  const groupId = useId();
  return (
    <RadioGroup
      aria-label={label}
      className="grid grid-cols-2 gap-1 sm:auto-cols-fr sm:grid-flow-col"
      onValueChange={(next) => {
        if (options.some((option) => option.value === next)) {
          onChange(next as Value);
        }
      }}
      value={value}
    >
      {options.map((option) => (
        <label
          className={`flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-input px-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${option.activeClassName}`}
          htmlFor={`${groupId}-${option.value}`}
          key={option.value}
        >
          <RadioGroupItem
            className="sr-only"
            id={`${groupId}-${option.value}`}
            value={option.value}
          />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  );
}
