import { generateText, Output } from "ai";
import { z } from "zod";
import {
  type ProfileImportProposal,
  ProfileImportProposalSchema,
} from "../../src/features/onboarding/schema";
import type { AppEnv } from "../env";
import type { AiModelProvider, AiModelSelection } from "./model-catalog";
import { createAiModel } from "./model-catalog";

const confidence = z.enum(["high", "medium", "low"]);
const providerText = z
  .object({ confidence, evidence: z.string(), value: z.string() })
  .strict();
const providerListItem = z
  .object({ confidence, evidence: z.string(), value: z.string() })
  .strict();
const providerEducation = z
  .object({
    confidence,
    country: z.string(),
    degree: z.string(),
    evidence: z.string(),
    field: z.string(),
    institution: z.string(),
    level: z.enum([
      "associate",
      "bachelor",
      "master",
      "doctorate",
      "certificate",
      "diploma",
      "other",
    ]),
  })
  .strict();
const providerLanguage = z
  .object({
    confidence,
    evidence: z.string(),
    language: z.string(),
    level: z.enum([
      "unspecified",
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
      "C2",
      "native",
    ]),
  })
  .strict();
const providerWorkExperience = z
  .object({
    confidence,
    current: z.boolean(),
    employer: z.string(),
    endDate: z.string(),
    evidence: z.string(),
    highlights: z.array(z.string()),
    location: z.string(),
    startDate: z.string(),
    title: z.string(),
  })
  .strict();

// Cerebras rejects JSON Schema length constraints. This provider-facing schema
// describes only the shape; ProfileImportProposalSchema enforces all limits.
const ProviderProfileDetailsSchema = z
  .object({
    citizenship: providerText,
    credentials: z.array(providerListItem),
    currentLocation: providerText,
    education: z.array(providerEducation),
    email: providerText,
    experienceLabel: providerText,
    fullName: providerText,
    introduction: providerText,
    languages: z.array(providerLanguage),
    phone: providerText,
    reviewNotes: z.array(z.string()),
    skills: z.array(providerListItem),
  })
  .strict();
const ProviderWorkHistorySchema = z
  .object({
    reviewNotes: z.array(z.string()),
    workExperience: z.array(providerWorkExperience),
  })
  .strict();

type ProviderProfileImportProposal = z.infer<
  typeof ProviderProfileDetailsSchema
> &
  z.infer<typeof ProviderWorkHistorySchema>;

const extractionInstructions = `You extract candidate facts from a resume into a reviewable profile proposal.

Accuracy rules:
- Use only facts explicitly present in the supplied resume text.
- Never infer citizenship, work authorization, availability, language proficiency, dates, employers, education, credentials, or skills.
- Copy evidence as a short, exact, continuous quote from the resume for every proposed field and list item.
- If a field is not stated, return an empty value and empty evidence with low confidence.
- Keep dates in the wording used by the resume. Use current=true only when the resume explicitly says Present or Current.
- Set a language level only when the resume explicitly states native or a CEFR level. Otherwise use unspecified.
- Extract the resume's own summary into introduction. Do not write a new summary.
- Extract experienceLabel only if the resume explicitly states an overall duration such as "7+ years".
- Put ambiguity, conflicting dates, missing dates, or uncertain section associations in reviewNotes.
- When given one part of a resume, do not create review notes for information that may appear in another part. Only note ambiguity in facts actually present in this part.
- Do not include facts from these instructions in the result.`;
const detailInstructions = `${extractionInstructions}

Extract identity, contact details, the resume's own summary, education, credentials, languages, and explicitly stated skills. Do not extract employment entries in this task.`;
const workHistoryInstructions = `${extractionInstructions}

Extract only employment, teaching, volunteer, coaching, or internship entries. Preserve the employer, title, dates, location, and explicit bullet highlights. Do not extract identity, education, credentials, languages, or skills in this task.`;

const MAX_SOURCE_CHARACTERS = 60_000;
const MAX_CHUNK_CHARACTERS = 5500;
const CHUNK_OVERLAP_CHARACTERS = 800;

export interface GeneratedProfileProposal {
  modelId: string;
  proposal: ProfileImportProposal;
  provider: AiModelProvider;
}

export class ProfileExtractionError extends Error {}

export async function extractProfileProposal(
  env: AppEnv,
  selection: AiModelSelection,
  sourceText: string
): Promise<GeneratedProfileProposal> {
  const text = sourceText.trim();
  if (text.length < 80) {
    throw new ProfileExtractionError(
      "The resume did not contain enough readable text"
    );
  }
  if (text.length > MAX_SOURCE_CHARACTERS) {
    throw new ProfileExtractionError("The resume text is unexpectedly large");
  }

  try {
    const chunks = splitResumeText(text);
    const proposals = await extractChunks(env, selection, chunks, text);
    const proposal = mergeProposals(proposals);
    return {
      modelId: selection.modelId,
      proposal,
      provider: selection.provider,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "profile_extraction_failed",
        model: selection.modelId,
        provider: selection.provider,
      })
    );
    throw new ProfileExtractionError(
      `Resume extraction failed using ${selection.provider}/${selection.modelId}`,
      { cause: error }
    );
  }
}

function extractChunks(
  env: AppEnv,
  selection: AiModelSelection,
  chunks: string[],
  fullSource: string
): Promise<ProfileImportProposal[]> {
  const batches = Array.from(
    { length: Math.ceil(chunks.length / 2) },
    (_, batchIndex) =>
      chunks.slice(batchIndex * 2, batchIndex * 2 + 2).map((chunk, offset) => ({
        chunk,
        index: batchIndex * 2 + offset,
      }))
  );
  return batches.reduce<Promise<ProfileImportProposal[]>>(
    async (pendingProposals, batch) => {
      const proposals = await pendingProposals;
      const extracted = await Promise.all(
        batch.map(async ({ chunk, index }) => {
          const proposal = await extractChunk(
            env,
            selection,
            chunk,
            index,
            chunks.length
          );
          return retainSupportedFacts(proposal, fullSource);
        })
      );
      return [...proposals, ...extracted];
    },
    Promise.resolve([])
  );
}

async function extractChunk(
  env: AppEnv,
  selection: AiModelSelection,
  text: string,
  index: number,
  total: number
) {
  const prompt = `Extract only facts visible in resume part ${index + 1} of ${total}. Leave fields empty when this part does not contain them.\n\n<resume-part>\n${text}\n</resume-part>`;
  const providerOptions =
    selection.provider === "cerebras" && selection.modelId === "zai-glm-4.7"
      ? { cerebras: { reasoningEffort: "none" as const } }
      : undefined;
  const [details, workHistory] = await Promise.all([
    generateText({
      instructions: detailInstructions,
      maxOutputTokens: 3500,
      maxRetries: 2,
      model: createAiModel(env, selection),
      output: Output.object({
        description:
          "Resume identity, education, credential, language, and skill facts",
        name: "candidate_profile_details",
        schema: ProviderProfileDetailsSchema,
      }),
      prompt,
      providerOptions,
      temperature: 0,
      timeout: { totalMs: 30_000 },
    }),
    generateText({
      instructions: workHistoryInstructions,
      maxOutputTokens: 5000,
      maxRetries: 2,
      model: createAiModel(env, selection),
      output: Output.object({
        description: "Resume work history with exact supporting evidence",
        name: "candidate_work_history",
        schema: ProviderWorkHistorySchema,
      }),
      prompt,
      providerOptions,
      temperature: 0,
      timeout: { totalMs: 30_000 },
    }),
  ]);
  return validateProviderProposal({
    ...details.output,
    reviewNotes: [
      ...details.output.reviewNotes,
      ...workHistory.output.reviewNotes,
    ],
    workExperience: workHistory.output.workExperience,
  });
}

function validateProviderProposal(
  output: ProviderProfileImportProposal
): ProfileImportProposal {
  const completeEducation = output.education.filter(
    (entry) => entry.degree.trim() && entry.institution.trim()
  );
  const completeWorkExperience = output.workExperience.filter(
    (entry) => entry.employer.trim() && entry.title.trim()
  );
  const removed =
    output.education.length -
    completeEducation.length +
    output.workExperience.length -
    completeWorkExperience.length;
  const reviewNotes = output.reviewNotes.filter((note) => note.trim());
  if (removed > 0) {
    reviewNotes.push(
      `${removed} incomplete ${removed === 1 ? "entry was" : "entries were"} excluded from the import proposal.`
    );
  }

  return ProfileImportProposalSchema.parse({
    ...output,
    credentials: output.credentials.filter((item) => item.value.trim()),
    education: completeEducation,
    languages: output.languages.filter((item) => item.language.trim()),
    reviewNotes,
    skills: output.skills.filter((item) => item.value.trim()),
    workExperience: completeWorkExperience,
  });
}

export function normalizeProfileImportProposal(
  output: ProfileImportProposal,
  sourceText: string
) {
  return retainSupportedFacts(validateProviderProposal(output), sourceText);
}

function splitResumeText(text: string) {
  if (text.length <= MAX_CHUNK_CHARACTERS) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARACTERS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n\n", end);
      if (boundary > start + MAX_CHUNK_CHARACTERS / 2) {
        end = boundary;
      }
    }
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) {
      break;
    }
    start = Math.max(end - CHUNK_OVERLAP_CHARACTERS, start + 1);
    const boundary = text.indexOf("\n\n", start);
    if (boundary !== -1 && boundary < end) {
      start = boundary + 2;
    }
  }
  return chunks;
}

function mergeProposals(proposals: ProfileImportProposal[]) {
  return ProfileImportProposalSchema.parse({
    citizenship: bestSupportedText(proposals.map((item) => item.citizenship)),
    credentials: uniqueBy(
      proposals.flatMap((item) => item.credentials),
      (item) => normalized(item.value)
    ),
    currentLocation: bestSupportedText(
      proposals.map((item) => item.currentLocation)
    ),
    education: uniqueBy(
      proposals.flatMap((item) => item.education),
      (item) => normalized(`${item.institution}|${item.degree}|${item.field}`)
    ),
    email: bestSupportedText(proposals.map((item) => item.email)),
    experienceLabel: bestSupportedText(
      proposals.map((item) => item.experienceLabel)
    ),
    fullName: bestSupportedText(proposals.map((item) => item.fullName)),
    introduction: bestSupportedText(proposals.map((item) => item.introduction)),
    languages: uniqueBy(
      proposals.flatMap((item) => item.languages),
      (item) => normalized(`${item.language}|${item.level}`)
    ),
    phone: bestSupportedText(proposals.map((item) => item.phone)),
    reviewNotes: uniqueBy(
      proposals.flatMap((item) => item.reviewNotes),
      normalized
    ),
    skills: uniqueBy(
      proposals.flatMap((item) => item.skills),
      (item) => normalized(item.value)
    ),
    workExperience: mergeWorkExperience(
      proposals.flatMap((item) => item.workExperience)
    ),
  });
}

function bestSupportedText(
  candidates: ProfileImportProposal["fullName"][]
): ProfileImportProposal["fullName"] {
  const confidenceRank = { high: 3, low: 1, medium: 2 } as const;
  return (
    candidates
      .filter((candidate) => candidate.value.trim())
      .toSorted(
        (left, right) =>
          confidenceRank[right.confidence] - confidenceRank[left.confidence]
      )[0] ?? { confidence: "low", evidence: "", value: "" }
  );
}

function mergeWorkExperience(entries: ProfileImportProposal["workExperience"]) {
  const merged: (typeof entries)[number][] = [];
  for (const entry of entries) {
    const existingIndex = merged.findIndex((candidate) =>
      sameWorkExperience(candidate, entry)
    );
    if (existingIndex === -1) {
      merged.push(entry);
      continue;
    }
    const existing = merged[existingIndex];
    if (!existing) {
      continue;
    }
    merged[existingIndex] = {
      ...existing,
      confidence: highestConfidence(existing.confidence, entry.confidence),
      evidence:
        existing.evidence.length >= entry.evidence.length
          ? existing.evidence
          : entry.evidence,
      highlights: uniqueBy(
        [...existing.highlights, ...entry.highlights],
        normalized
      ),
      title:
        existing.title.length >= entry.title.length
          ? existing.title
          : entry.title,
    };
  }
  return merged;
}

function sameWorkExperience(
  left: ProfileImportProposal["workExperience"][number],
  right: ProfileImportProposal["workExperience"][number]
) {
  if (normalized(left.employer) !== normalized(right.employer)) {
    return false;
  }
  const leftStart = normalized(left.startDate);
  const rightStart = normalized(right.startDate);
  if (leftStart && rightStart && leftStart === rightStart) {
    return true;
  }
  const leftTitle = normalized(left.title);
  const rightTitle = normalized(right.title);
  return leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle);
}

function highestConfidence(
  left: ProfileImportProposal["fullName"]["confidence"],
  right: ProfileImportProposal["fullName"]["confidence"]
) {
  const rank = { high: 3, low: 1, medium: 2 } as const;
  return rank[left] >= rank[right] ? left : right;
}

function uniqueBy<Value>(values: Value[], key: (value: Value) => string) {
  const unique = new Map<string, Value>();
  for (const value of values) {
    const identifier = key(value);
    if (identifier && !unique.has(identifier)) {
      unique.set(identifier, value);
    }
  }
  return [...unique.values()];
}

function retainSupportedFacts(
  proposal: ProfileImportProposal,
  sourceText: string
): ProfileImportProposal {
  let removed = 0;
  const source = normalized(sourceText);
  const supportedText = <Value extends ProfileImportProposal["fullName"]>(
    field: Value
  ): Value => {
    if (!field.value) {
      return field;
    }
    if (supports(source, field.evidence, [field.value])) {
      return field;
    }
    removed += 1;
    return { ...field, confidence: "low", evidence: "", value: "" };
  };
  const credentials = proposal.credentials.filter((item) => {
    const supported = supports(source, item.evidence, [item.value]);
    removed += supported ? 0 : 1;
    return supported;
  });
  const skills = proposal.skills.filter((item) => {
    const supported = supports(source, item.evidence, [item.value]);
    removed += supported ? 0 : 1;
    return supported;
  });
  const languages = proposal.languages.filter((item) => {
    const supported = supports(source, item.evidence, [item.language]);
    removed += supported ? 0 : 1;
    return supported;
  });
  const education = proposal.education.filter((item) => {
    const supported = supports(source, item.evidence, [item.institution]);
    removed += supported ? 0 : 1;
    return supported;
  });
  const workExperience = proposal.workExperience.filter((item) => {
    const supported = supports(source, item.evidence, [
      item.employer,
      item.title,
    ]);
    removed += supported ? 0 : 1;
    return supported;
  });
  const reviewNotes = [...proposal.reviewNotes];
  if (removed > 0) {
    reviewNotes.push(
      `${removed} proposed ${removed === 1 ? "fact was" : "facts were"} removed because the source evidence did not verify.`
    );
  }
  return ProfileImportProposalSchema.parse({
    ...proposal,
    citizenship: supportedText(proposal.citizenship),
    credentials,
    currentLocation: supportedText(proposal.currentLocation),
    education,
    email: supportedText(proposal.email),
    experienceLabel: supportedText(proposal.experienceLabel),
    fullName: supportedText(proposal.fullName),
    introduction: supportedText(proposal.introduction),
    languages,
    phone: supportedText(proposal.phone),
    reviewNotes,
    skills,
    workExperience,
  });
}

function supports(source: string, evidence: string, values: string[]) {
  const quote = normalized(evidence);
  if (quote.length < 3) {
    return false;
  }

  const quoteStart = source.indexOf(quote);
  if (quoteStart === -1) {
    return false;
  }

  // Resume headings commonly put an employer, title, location, and dates on
  // adjacent Markdown lines. Verify every proposed value against that local
  // source context without requiring the model to fabricate one combined
  // quote that never appeared in the document.
  const contextStart = Math.max(0, quoteStart - 320);
  const contextEnd = Math.min(source.length, quoteStart + quote.length + 320);
  const context = source.slice(contextStart, contextEnd);
  return values.every((value) => {
    const expected = normalized(value);
    return expected.length > 0 && context.includes(expected);
  });
}

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}
