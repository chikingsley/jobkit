import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountryMulti } from "@/features/preferences/country-multi";
import {
  BenefitSection,
  PreferenceSection,
} from "@/features/preferences/strength-section";
import type { ApiRequest } from "@/lib/api";
import type { Preferences } from "@/profile-types";

const salaryOptions = [
  { label: "No minimum", value: "0" },
  { label: "$1,000/month", value: "1000" },
  { label: "$1,500/month", value: "1500" },
  { label: "$2,000/month", value: "2000" },
  { label: "$3,000/month", value: "3000" },
  { label: "$5,000+/month", value: "5000" },
];

export function PreferencesView({
  preferences,
  request,
  onSaved,
}: {
  preferences: Preferences;
  request: ApiRequest;
  onSaved: (preferences: Preferences) => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(preferences);
    setDirty(false);
  }, [preferences]);

  function update(next: Preferences) {
    setDraft(next);
    setDirty(true);
  }

  function updateCountries(
    kind: keyof Preferences["countries"],
    values: string[]
  ) {
    const countries = {
      acceptable: draft.countries.acceptable.filter(
        (country) => kind === "acceptable" || !values.includes(country)
      ),
      excluded: draft.countries.excluded.filter(
        (country) => kind === "excluded" || !values.includes(country)
      ),
      preferred: draft.countries.preferred.filter(
        (country) => kind === "preferred" || !values.includes(country)
      ),
      [kind]: values,
    };
    update({ ...draft, countries });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await request("/api/preferences", {
        body: JSON.stringify(draft),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (!response.ok) {
        throw new Error("Preferences could not be saved");
      }
      onSaved(draft);
      setDirty(false);
      toast.success("Preferences saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPage>
      <SettingsSection className="border-t-0 pt-0" title="Countries">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-5">
          <CountryMulti
            description="Prioritize these destinations."
            label="Preferred"
            onChange={(values) => updateCountries("preferred", values)}
            values={draft.countries.preferred}
          />
          <CountryMulti
            description="Keep these in the normal queue."
            label="Acceptable"
            onChange={(values) => updateCountries("acceptable", values)}
            values={draft.countries.acceptable}
          />
          <CountryMulti
            description="Hide unless hard blockers are shown."
            label="Excluded"
            onChange={(values) => updateCountries("excluded", values)}
            values={draft.countries.excluded}
          />
        </div>
      </SettingsSection>

      <PreferenceSection
        labels={[
          ["preschool", "Preschool"],
          ["primary", "Primary / elementary"],
          ["teenagers", "Teenagers / secondary"],
          ["college", "College / university"],
          ["adults", "Adults"],
        ]}
        onChange={(key, value) =>
          update({
            ...draft,
            audiences: { ...draft.audiences, [key]: value },
          })
        }
        title="Students"
        values={draft.audiences}
      />

      <PreferenceSection
        labels={[
          ["fullTime", "Full-time"],
          ["partTime", "Part-time"],
          ["contract", "Contract"],
        ]}
        onChange={(key, value) =>
          update({
            ...draft,
            employment: { ...draft.employment, [key]: value },
          })
        }
        title="Employment"
        values={draft.employment}
      />

      <PreferenceSection
        labels={[
          ["english_language", "English language"],
          ["homeroom", "Homeroom / classroom"],
          ["early_childhood", "Early childhood"],
          ["subject_specialist", "Subject specialist"],
          ["leadership", "Leadership"],
          ["student_support", "Student support"],
          ["other", "Other roles"],
        ]}
        onChange={(key, value) =>
          update({
            ...draft,
            roles: { ...draft.roles, [key]: value },
          })
        }
        title="Roles"
        values={draft.roles}
      />

      <BenefitSection
        labels={[
          ["housing", "Housing included"],
          ["airfare", "Airfare / flight allowance"],
          ["healthInsurance", "Health insurance"],
          ["paidLeave", "Paid leave"],
          ["visaSponsorship", "Visa sponsorship"],
          ["professionalDevelopment", "Professional development"],
        ]}
        onChange={(key, value) =>
          update({ ...draft, benefits: { ...draft.benefits, [key]: value } })
        }
        title="Benefits"
        values={draft.benefits}
      />

      <SettingsSection title="Pay">
        <Field className="max-w-sm">
          <FieldLabel>Minimum monthly pay (USD)</FieldLabel>
          <Select
            items={salaryOptions}
            onValueChange={(value) =>
              update({ ...draft, minimumMonthlyUsd: Number(value) })
            }
            value={String(draft.minimumMonthlyUsd)}
          >
            <SelectTrigger aria-label="Minimum monthly pay" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {salaryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Jobs without listed pay remain visible.
          </FieldDescription>
        </Field>
      </SettingsSection>

      <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur-sm">
        {dirty ? (
          <span className="text-muted-foreground text-sm">Unsaved changes</span>
        ) : null}
        <Button disabled={!dirty || saving} onClick={() => void save()}>
          <Save />
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </SettingsPage>
  );
}
