import type { CountryCode } from "libphonenumber-js";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { countryOptions, languageOptions } from "@/form-options";
import type { ApiRequest } from "@/lib/api";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en");
}

export function TextField({
  className,
  description,
  error,
  label,
  registration,
  type = "text",
}: {
  className?: string;
  description?: string;
  error?: string;
  label: string;
  registration: UseFormRegisterReturn;
  type?: string;
}) {
  const id = `field-${registration.name.replaceAll(/[.[\]]/g, "-")}`;
  return (
    <Field className={className} data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        aria-invalid={Boolean(error)}
        id={id}
        type={type}
        {...registration}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

export function SearchComboboxField({
  className,
  error,
  items,
  label,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  error?: string;
  items: string[];
  label: string;
  onChange: (value: string | null) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Field className={className} data-invalid={Boolean(error)}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox items={items} onValueChange={onChange} value={value || null}>
        <ComboboxInput
          aria-invalid={Boolean(error)}
          aria-label={label}
          placeholder={placeholder}
          showClear
        />
        <ComboboxContent>
          <ComboboxEmpty>No matches found.</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

export function LanguageField({
  className,
  label,
  onChange,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [query, setQuery] = useState(value);

  useEffect(() => setQuery(value), [value]);

  const items = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return languageOptions;
    }
    const normalizedQuery = normalizeSearchText(trimmed);
    const matches = languageOptions.filter((name) =>
      normalizeSearchText(name).includes(normalizedQuery)
    );
    return matches.some((name) => normalizeSearchText(name) === normalizedQuery)
      ? matches
      : [trimmed, ...matches].slice(0, 50);
  }, [query]);

  return (
    <Field className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        inputValue={query}
        items={items}
        onInputValueChange={(next) => {
          setQuery(next);
          onChange(next);
        }}
        onValueChange={(next) => {
          if (next) {
            const name = String(next);
            setQuery(name);
            onChange(name);
          }
        }}
        value={value || null}
      >
        <ComboboxInput
          aria-label={label}
          placeholder="Search or type a language"
          showClear
        />
        <ComboboxContent>
          <ComboboxEmpty>
            No language found. Your typed name is accepted.
          </ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

export function MultipleComboboxField({
  items,
  label,
  onChange,
  values,
}: {
  items: string[];
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
        items={items}
        multiple
        onValueChange={(value) => onChange(value as string[])}
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
                    values.length ? "Add another" : "Search expertise"
                  }
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No matches found.</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

export function CountryCodePicker({
  onChange,
  value,
}: {
  onChange: (value: CountryCode) => void;
  value: CountryCode;
}) {
  const items = countryOptions.map(
    (item) => `${item.label} · ${item.callingCode}`
  );
  const selected = countryOptions.find((item) => item.code === value);
  const selectedLabel = selected
    ? `${selected.label} · ${selected.callingCode}`
    : null;
  return (
    <Combobox
      items={items}
      onValueChange={(next) => {
        const index = next ? items.indexOf(String(next)) : -1;
        const country = countryOptions[index];
        if (country) {
          onChange(country.code);
        }
      }}
      value={selectedLabel}
    >
      <ComboboxInput
        aria-label="Phone country"
        placeholder="Search country or code"
      />
      <ComboboxContent>
        <ComboboxEmpty>No calling code found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function UniversityField({
  className,
  country,
  error,
  onChange,
  request,
  value,
}: {
  className?: string;
  country: string;
  error?: string;
  onChange: (value: string) => void;
  request: ApiRequest;
  value: string;
}) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[]>(value ? [value] : []);
  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() });
      if (country) {
        params.set("country", country);
      }
      void request(`/api/universities?${params}`, {
        signal: controller.signal,
      })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ universities: string[] }>)
            : { universities: [] }
        )
        .then((data: { universities: string[] }) =>
          setItems([...new Set([query, ...data.universities])])
        )
        .catch(() => setItems([query]));
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [country, query, request]);
  return (
    <Field className={className} data-invalid={Boolean(error)}>
      <FieldLabel>Institution</FieldLabel>
      <Combobox
        inputValue={query}
        items={items}
        onInputValueChange={(next) => {
          setQuery(next);
          onChange(next);
        }}
        onValueChange={(next) => {
          if (next) {
            setQuery(String(next));
            onChange(String(next));
          }
        }}
        value={value || null}
      >
        <ComboboxInput
          aria-invalid={Boolean(error)}
          aria-label="Institution"
          placeholder="Search universities"
        />
        <ComboboxContent>
          <ComboboxEmpty>Keep the typed institution.</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

export function LocationField({
  error,
  onBlur,
  onChange,
  request,
  value,
}: {
  error?: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  request: ApiRequest;
  value: string;
}) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[]>(value ? [value] : []);

  useEffect(() => {
    setQuery(value);
    setItems((current) =>
      value ? [...new Set([value, ...current])] : current
    );
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setItems(trimmed ? [trimmed] : []);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed });
      void request(`/api/locations?${params}`, {
        signal: controller.signal,
      })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ locations: string[] }>)
            : { locations: [] }
        )
        .then((data: { locations: string[] }) =>
          setItems(
            data.locations.length ? [...new Set(data.locations)] : [trimmed]
          )
        )
        .catch(() => setItems([trimmed]));
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, request]);

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel>Current location</FieldLabel>
      <Combobox
        inputValue={query}
        items={items}
        onInputValueChange={(next) => {
          setQuery(next);
          onChange(next);
        }}
        onOpenChange={(open) => {
          if (!open) {
            onBlur();
          }
        }}
        onValueChange={(next) => {
          if (next) {
            const location = String(next);
            setQuery(location);
            onChange(location);
          }
        }}
        value={value || null}
      >
        <ComboboxInput
          aria-invalid={Boolean(error)}
          aria-label="Current location"
          autoComplete="address-level2"
          placeholder="Search city, region, or country"
          showClear
        />
        <ComboboxContent>
          <ComboboxEmpty>Keep the typed location.</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

export function StringListField({
  addLabel,
  description,
  label,
  onChange,
  values,
}: {
  addLabel: string;
  description: string;
  label: string;
  onChange: (values: string[]) => void;
  values: string[];
}) {
  const itemIds = useRef<string[]>([]);
  while (itemIds.current.length < values.length) {
    itemIds.current.push(crypto.randomUUID());
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-col gap-2">
        {values.map((value, index) => (
          <div className="flex items-center gap-2" key={itemIds.current[index]}>
            <Input
              aria-label={`${label} ${index + 1}`}
              onChange={(event) => {
                const next = [...values];
                next[index] = event.target.value;
                onChange(next);
              }}
              value={value}
            />
            <Button
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => {
                itemIds.current.splice(index, 1);
                onChange(values.filter((_, item) => item !== index));
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          className="w-fit"
          onClick={() => onChange([...values, ""])}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus /> {addLabel}
        </Button>
      </div>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}
