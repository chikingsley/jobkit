import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { countryNamesOnly } from "@/form-options";

export function CountryMulti({
  description,
  label,
  onChange,
  values,
}: {
  description: string;
  label: string;
  onChange: (values: string[]) => void;
  values: string[];
}) {
  const anchor = useComboboxAnchor();
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        autoHighlight
        items={countryNamesOnly}
        multiple
        onValueChange={(next) => onChange(next as string[])}
        value={values}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(selected) => (
              <>
                {(selected as string[]).map((value) => (
                  <ComboboxChip key={value}>{value}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  aria-label={label}
                  placeholder={
                    values.length ? "Add country" : "Search countries"
                  }
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No countries found.</ComboboxEmpty>
          <ComboboxList>
            {(country) => (
              <ComboboxItem key={country} value={country}>
                {country}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}
