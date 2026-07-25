import {
  type ProfileImportProposal,
  ProfileImportProposalSchema,
} from "../../src/features/onboarding/schema";

export function normalizeProfileImportProposal(
  output: ProfileImportProposal,
  sourceText: string
) {
  return retainSupportedFacts(normalizeProposal(output), sourceText);
}

function normalizeProposal(output: ProfileImportProposal) {
  const education = output.education.filter(
    (entry) => entry.degree.trim() && entry.institution.trim()
  );
  const workExperience = output.workExperience.filter(
    (entry) => entry.employer.trim() && entry.title.trim()
  );
  const removed =
    output.education.length -
    education.length +
    output.workExperience.length -
    workExperience.length;
  const reviewNotes = output.reviewNotes.filter((note) => note.trim());
  if (removed > 0) {
    reviewNotes.push(
      `${removed} incomplete ${removed === 1 ? "entry was" : "entries were"} excluded from the import proposal.`
    );
  }
  return ProfileImportProposalSchema.parse({
    ...output,
    credentials: output.credentials.filter((item) => item.value.trim()),
    education,
    languages: output.languages.filter((item) => item.language.trim()),
    reviewNotes,
    skills: output.skills.filter((item) => item.value.trim()),
    subjectQualifications: output.subjectQualifications.filter((item) =>
      item.value.trim()
    ),
    workExperience,
  });
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
  const subjectQualifications = proposal.subjectQualifications.filter(
    (item) => {
      const supported = supports(source, item.evidence, [item.value]);
      removed += supported ? 0 : 1;
      return supported;
    }
  );
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
    subjectQualifications,
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
