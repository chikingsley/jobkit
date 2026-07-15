import { Plus, Trash2 } from "lucide-react";
import {
  type Control,
  Controller,
  type FieldErrors,
  type UseFormRegister,
  useFieldArray,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { StringListField, TextField } from "@/features/profile/form-fields";
import type { Profile } from "@/features/profile/schema";

export function WorkExperienceSection({
  control,
  errors,
  register,
}: {
  control: Control<Profile>;
  errors: FieldErrors<Profile>;
  register: UseFormRegister<Profile>;
}) {
  const experience = useFieldArray({ control, name: "workExperience" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Work experience</CardTitle>
        <CardDescription>
          This is the complete career history used to build job-specific
          resumes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {experience.fields.map((entry, index) => (
          <FieldSet
            className="border-b pb-5 last:border-b-0 last:pb-0"
            key={entry.id}
          >
            <div className="flex items-center justify-between">
              <FieldLegend variant="label">Role {index + 1}</FieldLegend>
              <Button
                aria-label={`Remove role ${index + 1}`}
                onClick={() => experience.remove(index)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
            <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-4">
              <TextField
                error={errors.workExperience?.[index]?.title?.message}
                label="Role"
                registration={register(`workExperience.${index}.title`)}
              />
              <TextField
                error={errors.workExperience?.[index]?.employer?.message}
                label="Employer"
                registration={register(`workExperience.${index}.employer`)}
              />
              <TextField
                label="Location"
                registration={register(`workExperience.${index}.location`)}
              />
              <TextField
                label="Start date"
                registration={register(`workExperience.${index}.startDate`)}
              />
              <TextField
                label="End date"
                registration={register(`workExperience.${index}.endDate`)}
              />
              <Controller
                control={control}
                name={`workExperience.${index}.current`}
                render={({ field }) => (
                  <Field className="self-end">
                    <div className="flex min-h-9 items-center gap-2">
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(value) =>
                          field.onChange(Boolean(value))
                        }
                      />
                      <FieldLabel>Current role</FieldLabel>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
            <Controller
              control={control}
              name={`workExperience.${index}.highlights`}
              render={({ field }) => (
                <StringListField
                  addLabel="Add highlight"
                  description="Keep the full factual record here; a tailored resume can select the relevant points."
                  label="Highlights"
                  onChange={field.onChange}
                  values={field.value}
                />
              )}
            />
          </FieldSet>
        ))}
        <Button
          className="w-fit"
          onClick={() =>
            experience.append({
              current: false,
              employer: "",
              endDate: "",
              highlights: [],
              location: "",
              startDate: "",
              title: "",
            })
          }
          type="button"
          variant="outline"
        >
          <Plus /> Add role
        </Button>
      </CardContent>
    </Card>
  );
}
