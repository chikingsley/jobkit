import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { ApiRequest } from "@/lib/api";

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
