import { useId } from "react";
import { SettingsSection } from "@/components/settings-section";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BenefitStrength, RuleStrength } from "@/profile-types";

const preferenceStrengthOptions: Array<{
  label: string;
  value: RuleStrength;
}> = [
  { label: "Exclude", value: "exclude" },
  { label: "Avoid", value: "avoid" },
  { label: "Open", value: "accept" },
  { label: "Prefer", value: "prefer" },
];

const benefitStrengthOptions: Array<{
  label: string;
  value: BenefitStrength;
}> = [
  { label: "Optional", value: "accept" },
  { label: "Preferred", value: "prefer" },
  { label: "Required", value: "required" },
];

export function PreferenceSection<Key extends string>({
  labels,
  onChange,
  title,
  values,
}: {
  labels: [Key, string][];
  onChange: (key: Key, value: RuleStrength) => void;
  title: string;
  values: Record<Key, RuleStrength>;
}) {
  return (
    <SettingsSection title={title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-6 gap-y-5">
        {labels.map(([key, label]) => (
          <Field key={key}>
            <FieldLabel>{label}</FieldLabel>
            <PreferenceToggle
              onChange={(value) => onChange(key, value)}
              value={values[key] ?? "accept"}
            />
          </Field>
        ))}
      </div>
    </SettingsSection>
  );
}

export function BenefitSection<Key extends string>({
  labels,
  onChange,
  title,
  values,
}: {
  labels: [Key, string][];
  onChange: (key: Key, value: BenefitStrength) => void;
  title: string;
  values: Record<Key, BenefitStrength>;
}) {
  return (
    <SettingsSection title={title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-6 gap-y-5">
        {labels.map(([key, label]) => (
          <Field key={key}>
            <FieldLabel>{label}</FieldLabel>
            <BenefitToggle
              onChange={(value) => onChange(key, value)}
              value={values[key] ?? "accept"}
            />
          </Field>
        ))}
      </div>
    </SettingsSection>
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
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  const groupId = useId();
  return (
    <RadioGroup
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-0 overflow-hidden rounded-md border border-input shadow-xs"
      onValueChange={(next) => {
        if (options.some((option) => option.value === next)) {
          onChange(next as Value);
        }
      }}
      value={value}
    >
      {options.map((option) => (
        <label
          className="flex min-h-9 min-w-0 cursor-pointer items-center justify-center border-input border-l px-2 font-medium text-muted-foreground text-xs transition-colors first:border-l-0 hover:bg-muted hover:text-foreground has-focus-visible:z-10 has-data-checked:bg-primary has-data-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:hover:bg-primary/90 has-data-checked:hover:text-primary-foreground"
          htmlFor={`${groupId}-${option.value}`}
          key={option.value}
        >
          <RadioGroupItem
            className="absolute size-px overflow-hidden opacity-0"
            id={`${groupId}-${option.value}`}
            value={option.value}
          />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  );
}
