import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CountryCode,
  formatIncompletePhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { useEffect, useState } from "react";
import {
  Controller,
  type Resolver,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
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
  EducationSection,
  LanguagesSection,
  WorkAuthorizationSection,
} from "@/features/profile/field-array-sections";
import {
  CountryCodePicker,
  LocationField,
  MultipleComboboxField,
  SearchComboboxField,
  StringListField,
  TextField,
} from "@/features/profile/form-fields";
import { type Profile, ProfileSchema } from "@/features/profile/schema";
import { WorkExperienceSection } from "@/features/profile/work-experience-section";
import {
  availabilityOptions,
  countryNamesOnly,
  countryOptions,
  expertiseOptions,
} from "@/form-options";
import type { ApiRequest } from "@/lib/api";

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
    <SettingsPage>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <SettingsSection
          className="border-t-0 pt-0"
          title="Identity and availability"
        >
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
                    <SelectTrigger aria-label="Availability" className="w-full">
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
              label="Experience label"
              registration={register("experienceLabel")}
            />
          </FieldGroup>
        </SettingsSection>

        <WorkExperienceSection
          control={control}
          errors={errors}
          register={register}
        />

        <EducationSection
          control={control}
          education={education}
          errors={errors}
          register={register}
          request={request}
          watch={watch}
        />

        <LanguagesSection control={control} languages={languages} />

        <SettingsSection title="Qualifications and expertise">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-5">
            <Controller
              control={control}
              name="subjectQualifications"
              render={({ field }) => (
                <MultipleComboboxField
                  items={expertiseOptions}
                  label="Subjects qualified to teach"
                  onChange={field.onChange}
                  values={field.value}
                />
              )}
            />
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
                  label="Credentials"
                  onChange={field.onChange}
                  values={field.value}
                />
              )}
            />
          </div>
        </SettingsSection>

        <WorkAuthorizationSection
          authorization={authorization}
          control={control}
          register={register}
          setValue={setValue}
          watch={watch}
        />

        <SettingsSection title="Application introduction">
          <Field>
            <FieldLabel htmlFor="introduction">Introduction</FieldLabel>
            <Textarea
              className="min-h-32"
              id="introduction"
              {...register("introduction")}
            />
          </Field>
        </SettingsSection>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur-sm">
          {isDirty ? (
            <span className="text-muted-foreground text-sm">
              Unsaved changes
            </span>
          ) : null}
          <Button disabled={!isDirty || isSubmitting} type="submit">
            {isSubmitting ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </SettingsPage>
  );
}
