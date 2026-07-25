import { Plus, Trash2 } from "lucide-react";
import type {
  Control,
  FieldErrors,
  UseFieldArrayReturn,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { Controller } from "react-hook-form";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LanguageField,
  SearchComboboxField,
  TextField,
  UniversityField,
} from "@/features/profile/form-fields";
import type { Profile } from "@/features/profile/schema";
import { countryNamesOnly, languageLevelOptions } from "@/form-options";
import type { ApiRequest } from "@/lib/api";

const degreeLevelOptions = [
  { label: "Associate degree", value: "associate" },
  { label: "Bachelor’s degree", value: "bachelor" },
  { label: "Master’s degree", value: "master" },
  { label: "Doctorate", value: "doctorate" },
  { label: "Certificate", value: "certificate" },
  { label: "Diploma", value: "diploma" },
  { label: "Other", value: "other" },
] as const;

const authorizationStatusOptions = [
  { label: "Citizen", value: "citizen" },
  { label: "Permanent resident", value: "permanent-resident" },
  { label: "Temporary resident", value: "temporary-resident" },
  { label: "Work permit", value: "work-permit" },
  { label: "Other", value: "other" },
] as const;

interface ProfileFieldArraySectionsProps {
  authorization: UseFieldArrayReturn<Profile, "workAuthorization">;
  control: Control<Profile>;
  education: UseFieldArrayReturn<Profile, "education">;
  errors: FieldErrors<Profile>;
  languages: UseFieldArrayReturn<Profile, "languages">;
  register: UseFormRegister<Profile>;
  request: ApiRequest;
  setValue: UseFormSetValue<Profile>;
  watch: UseFormWatch<Profile>;
}

export function EducationSection({
  control,
  education,
  errors,
  register,
  request,
  watch,
}: Pick<
  ProfileFieldArraySectionsProps,
  "control" | "education" | "errors" | "register" | "request" | "watch"
>) {
  return (
    <SettingsSection title="Education">
      <div className="flex flex-col gap-4">
        {education.fields.map((entry, index) => (
          <FieldSet
            className="border-b pb-5 last:border-b-0 last:pb-0"
            key={entry.id}
          >
            <div className="flex items-center justify-between">
              <FieldLegend variant="label">Education {index + 1}</FieldLegend>
              <Button
                aria-label="Remove education"
                onClick={() => education.remove(index)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
            <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-4">
              <Controller
                control={control}
                name={`education.${index}.level`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>Degree level</FieldLabel>
                    <Select
                      items={[...degreeLevelOptions]}
                      onValueChange={(value) => field.onChange(String(value))}
                      value={field.value}
                    >
                      <SelectTrigger
                        aria-label="Degree level"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {degreeLevelOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <TextField
                error={errors.education?.[index]?.degree?.message}
                label="Degree title"
                registration={register(`education.${index}.degree`)}
              />
              <TextField
                label="Field of study"
                registration={register(`education.${index}.field`)}
              />
              <Controller
                control={control}
                name={`education.${index}.institution`}
                render={({ field, fieldState }) => (
                  <UniversityField
                    country={watch(`education.${index}.country`)}
                    error={fieldState.error?.message}
                    onChange={field.onChange}
                    request={request}
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name={`education.${index}.country`}
                render={({ field }) => (
                  <SearchComboboxField
                    items={countryNamesOnly}
                    label="Country"
                    onChange={(value) => field.onChange(value ?? "")}
                    placeholder="Search countries"
                    value={field.value}
                  />
                )}
              />
            </FieldGroup>
          </FieldSet>
        ))}
        <Button
          onClick={() =>
            education.append({
              country: "",
              degree: "",
              field: "",
              institution: "",
              level: "bachelor",
            })
          }
          type="button"
          variant="outline"
        >
          <Plus /> Add education
        </Button>
      </div>
    </SettingsSection>
  );
}

export function LanguagesSection({
  control,
  languages,
}: Pick<ProfileFieldArraySectionsProps, "control" | "languages">) {
  return (
    <SettingsSection title="Languages">
      <div className="flex flex-col gap-4">
        {languages.fields.map((entry, index) => (
          <div
            className="flex flex-wrap items-end gap-3 border-b pb-4 last:border-b-0 last:pb-0"
            key={entry.id}
          >
            <Controller
              control={control}
              name={`languages.${index}.language`}
              render={({ field }) => (
                <LanguageField
                  className="min-w-60 flex-1"
                  label="Language"
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
            <Controller
              control={control}
              name={`languages.${index}.level`}
              render={({ field }) => (
                <Field className="w-40 flex-none">
                  <FieldLabel>Level</FieldLabel>
                  <Select
                    items={[...languageLevelOptions]}
                    onValueChange={(value) => field.onChange(String(value))}
                    value={field.value}
                  >
                    <SelectTrigger
                      aria-label="Language level"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {languageLevelOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Button
              aria-label="Remove language"
              onClick={() => languages.remove(index)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          onClick={() => languages.append({ language: "", level: "B1" })}
          type="button"
          variant="outline"
        >
          <Plus /> Add language
        </Button>
      </div>
    </SettingsSection>
  );
}

export function WorkAuthorizationSection({
  authorization,
  control,
  register,
  setValue,
  watch,
}: Pick<
  ProfileFieldArraySectionsProps,
  "authorization" | "control" | "register" | "setValue" | "watch"
>) {
  return (
    <SettingsSection title="Work authorization">
      <div className="flex flex-col gap-4">
        {authorization.fields.map((entry, index) => {
          const status = watch(`workAuthorization.${index}.status`);
          const hasExpiration = status !== "citizen";
          return (
            <div
              className="flex flex-wrap items-end gap-3 border-b pb-4 last:border-b-0 last:pb-0"
              key={entry.id}
            >
              <Controller
                control={control}
                name={`workAuthorization.${index}.country`}
                render={({ field }) => (
                  <SearchComboboxField
                    className="min-w-56 flex-1"
                    items={countryNamesOnly}
                    label="Country"
                    onChange={(value) => field.onChange(value ?? "")}
                    placeholder="Search countries"
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name={`workAuthorization.${index}.status`}
                render={({ field }) => (
                  <Field className="min-w-52 flex-1">
                    <FieldLabel>Status</FieldLabel>
                    <Select
                      items={[...authorizationStatusOptions]}
                      onValueChange={(value) => {
                        const next = String(value);
                        field.onChange(next);
                        if (next === "citizen") {
                          setValue(`workAuthorization.${index}.expiresAt`, "", {
                            shouldDirty: true,
                          });
                        }
                      }}
                      value={field.value}
                    >
                      <SelectTrigger
                        aria-label="Authorization status"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {authorizationStatusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              {hasExpiration ? (
                <TextField
                  className="w-44 flex-none"
                  label="Expires"
                  registration={register(
                    `workAuthorization.${index}.expiresAt`
                  )}
                  type="date"
                />
              ) : null}
              <Button
                aria-label="Remove authorization"
                onClick={() => authorization.remove(index)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
        <Button
          onClick={() =>
            authorization.append({
              country: "",
              expiresAt: "",
              status: "work-permit",
            })
          }
          type="button"
          variant="outline"
        >
          <Plus /> Add authorization
        </Button>
      </div>
    </SettingsSection>
  );
}
