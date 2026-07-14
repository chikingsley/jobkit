import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CountryCode,
  formatIncompletePhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Controller,
  type Resolver,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CountryCodePicker,
  LanguageField,
  LocationField,
  MultipleComboboxField,
  SearchComboboxField,
  StringListField,
  TextField,
  UniversityField,
} from "@/features/profile/form-fields";
import { type Profile, ProfileSchema } from "@/features/profile/schema";
import {
  availabilityOptions,
  countryNamesOnly,
  countryOptions,
  expertiseOptions,
  languageLevelOptions,
} from "@/form-options";
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

export function ProfileView({
  profile,
  request,
  onSaved,
}: {
  profile: Profile;
  request: ApiRequest;
  onSaved: (profile: Profile) => void;
}) {
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm<Profile>({
    defaultValues: profile,
    mode: "onBlur",
    resolver: zodResolver(ProfileSchema as never) as Resolver<Profile>,
  });
  const education = useFieldArray({ control, name: "education" });
  const languages = useFieldArray({ control, name: "languages" });
  const authorization = useFieldArray({ control, name: "workAuthorization" });
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(
    parsePhoneNumberFromString(profile.phone)?.country ?? "US"
  );

  useEffect(() => reset(profile), [profile, reset]);

  const save = handleSubmit(async (draft) => {
    const parsed = ProfileSchema.parse(draft);
    const response = await request("/api/profile", {
      body: JSON.stringify(parsed),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    if (!response.ok) {
      throw new Error("Profile could not be saved");
    }
    onSaved(parsed);
    reset(parsed);
    toast.success("Profile saved");
  });

  return (
    <SettingsPage
      description="Structured facts used to evaluate qualifications and prepare applications."
      title="Candidate profile"
    >
      <form className="flex flex-col gap-4" onSubmit={save}>
        <Card>
          <CardHeader>
            <CardTitle>Identity and availability</CardTitle>
            <CardDescription>
              Date of birth is intentionally not stored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-4">
              <TextField
                error={errors.fullName?.message}
                label="Full legal name"
                registration={register("fullName")}
              />
              <TextField
                error={errors.preferredName?.message}
                label="Preferred name"
                registration={register("preferredName")}
              />
              <TextField
                description="Used for applications."
                error={errors.email?.message}
                label="Email"
                registration={register("email")}
                type="email"
              />
              <Controller
                control={control}
                name="phone"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>Phone</FieldLabel>
                    <div className="grid grid-cols-1 gap-2">
                      <CountryCodePicker
                        onChange={setPhoneCountry}
                        value={phoneCountry}
                      />
                      <Input
                        aria-invalid={fieldState.invalid}
                        inputMode="tel"
                        onBlur={field.onBlur}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const digits = raw.replace(/\D/g, "");
                          const callingCode =
                            countryOptions.find(
                              (item) => item.code === phoneCountry
                            )?.callingCode ?? "+1";
                          const international = raw.startsWith("+")
                            ? `+${digits}`
                            : `${callingCode}${digits}`;
                          field.onChange(international);
                        }}
                        value={formatIncompletePhoneNumber(
                          field.value || "",
                          phoneCountry
                        )}
                      />
                    </div>
                    <FieldError
                      errors={fieldState.error ? [fieldState.error] : undefined}
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="currentLocation"
                render={({ field, fieldState }) => (
                  <LocationField
                    error={fieldState.error?.message}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    request={request}
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name="citizenship"
                render={({ field, fieldState }) => (
                  <SearchComboboxField
                    error={fieldState.error?.message}
                    items={countryNamesOnly}
                    label="Citizenship"
                    onChange={(value) => field.onChange(value ?? "")}
                    placeholder="Search countries"
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={control}
                name="availability"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>Availability</FieldLabel>
                    <Select
                      items={[...availabilityOptions]}
                      onValueChange={(value) => field.onChange(String(value))}
                      value={field.value}
                    >
                      <SelectTrigger
                        aria-label="Availability"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {availabilityOptions.map((option) => (
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
                description="Used in applications."
                label="Experience label"
                registration={register("experienceLabel")}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Education</CardTitle>
            <CardDescription>
              Add each degree as structured information.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {education.fields.map((entry, index) => (
              <FieldSet
                className="border-b pb-5 last:border-b-0 last:pb-0"
                key={entry.id}
              >
                <div className="flex items-center justify-between">
                  <FieldLegend variant="label">
                    Education {index + 1}
                  </FieldLegend>
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
                          onValueChange={(value) =>
                            field.onChange(String(value))
                          }
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
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Languages</CardTitle>
            <CardDescription>
              Use CEFR levels, with Native as a separate option.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
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
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Qualifications and expertise</CardTitle>
            <CardDescription>
              Add expertise tags and credentials as separate structured items.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-5">
            <Controller
              control={control}
              name="fields"
              render={({ field }) => (
                <MultipleComboboxField
                  items={expertiseOptions}
                  label="Fields of expertise"
                  onChange={field.onChange}
                  values={field.value}
                />
              )}
            />
            <Controller
              control={control}
              name="credentials"
              render={({ field }) => (
                <StringListField
                  addLabel="Add credential"
                  description="Qualifications and certificates that can be included with applications."
                  label="Credentials"
                  onChange={field.onChange}
                  values={field.value}
                />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work authorization</CardTitle>
            <CardDescription>
              Country, legal status, and expiration where applicable.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
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
                              setValue(
                                `workAuthorization.${index}.expiresAt`,
                                "",
                                { shouldDirty: true }
                              );
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
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Application introduction</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="introduction">Introduction</FieldLabel>
              <Textarea
                className="min-h-32"
                id="introduction"
                {...register("introduction")}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardFooter className="justify-end gap-3">
            {isDirty ? (
              <span className="text-muted-foreground text-sm">
                Unsaved changes
              </span>
            ) : null}
            <Button disabled={!isDirty || isSubmitting} type="submit">
              {isSubmitting ? "Saving…" : "Save profile"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </SettingsPage>
  );
}
