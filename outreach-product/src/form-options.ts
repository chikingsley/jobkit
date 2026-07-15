import { getCountries, getCountryCallingCode } from "libphonenumber-js";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryOptions = getCountries()
  .map((code) => ({
    callingCode: `+${getCountryCallingCode(code)}`,
    code,
    label: countryNames.of(code) ?? code,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const countryNamesOnly = countryOptions.map((country) => country.label);

export const availabilityOptions = [
  { label: "Available immediately", value: "immediately" },
  { label: "Available in 2 weeks", value: "two-weeks" },
  { label: "Available in 1 month", value: "one-month" },
  { label: "Available in 2–3 months", value: "two-three-months" },
  { label: "Available on a specific date", value: "specific-date" },
  { label: "Not currently available", value: "unavailable" },
] as const;

export const languageOptions = [
  "Albanian",
  "Amharic",
  "Arabic",
  "Azerbaijani",
  "Bangla",
  "Bulgarian",
  "Burmese",
  "Cantonese",
  "Czech",
  "English",
  "Estonian",
  "Filipino / Tagalog",
  "French",
  "Georgian",
  "German",
  "Greek",
  "Gujarati",
  "Hausa",
  "Hindi",
  "Hungarian",
  "Indonesian",
  "Italian",
  "Japanese",
  "Kannada",
  "Kazakh",
  "Khmer",
  "Korean",
  "Kyrgyz",
  "Malay",
  "Malayalam",
  "Maltese",
  "Mandarin Chinese",
  "Marathi",
  "Mongolian",
  "Nepali",
  "Oromo",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Quechua",
  "Romanian",
  "Russian",
  "Serbian",
  "Slovak",
  "Somali",
  "Spanish",
  "Swahili",
  "Tajik",
  "Tamazight",
  "Tamil",
  "Telugu",
  "Thai",
  "Turkish",
  "Ukrainian",
  "Urdu",
  "Uzbek",
  "Vietnamese",
  "Zulu",
];

export const languageLevelOptions = [
  { label: "Native", value: "native" },
  { label: "C2 — Mastery", value: "C2" },
  { label: "C1 — Advanced", value: "C1" },
  { label: "B2 — Upper intermediate", value: "B2" },
  { label: "B1 — Intermediate", value: "B1" },
  { label: "A2 — Elementary", value: "A2" },
  { label: "A1 — Beginner", value: "A1" },
] as const;

export const expertiseOptions = [
  "Adult education",
  "Biology",
  "Business English",
  "Chemistry / science",
  "Children and teenagers",
  "College learners",
  "Communicative English",
  "English / ESL",
  "Exam preparation",
  "Grammar instruction",
  "IELTS preparation",
  "Online instruction",
  "Primary education",
  "Speaking and pronunciation",
  "STEM education",
];

export const documentCategories = [
  { label: "Resume", value: "resume" },
  { label: "Professional photo", value: "photo" },
  { label: "Degree or diploma", value: "degree" },
  { label: "TEFL certificate", value: "tefl" },
  { label: "Teaching credentials", value: "teaching-credentials" },
  { label: "Passport", value: "passport" },
  { label: "Background check", value: "background-check" },
  { label: "Reference letter", value: "reference-letter" },
  { label: "Other", value: "other" },
] as const;

export function documentCategoryLabel(value: string) {
  return (
    documentCategories.find((category) => category.value === value)?.label ??
    value
      .replaceAll("-", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}
