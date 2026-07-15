import { z } from "zod";

export const MessageStyleChoiceSchema = z.enum(["a", "b", "equal"]);
export type MessageStyleChoice = z.infer<typeof MessageStyleChoiceSchema>;
export type MessageStyleChoices = Record<string, MessageStyleChoice>;

interface CalibrationOption {
  example: string;
  guidance: string;
  label: string;
}

export interface MessageStyleComparison {
  id: string;
  optionA: CalibrationOption;
  optionB: CalibrationOption;
  prompt: string;
}

export const messageStyleComparisons: MessageStyleComparison[] = [
  {
    id: "opening",
    optionA: {
      example:
        "I’m an experienced English teacher available to start in August.",
      guidance:
        "Open with the strongest relevant fact and concrete availability.",
      label: "Lead with the useful fact",
    },
    optionB: {
      example:
        "I’m writing to express my interest in the English teaching role.",
      guidance: "Open by stating interest in the specific role.",
      label: "Lead with interest",
    },
    prompt: "How should the first sentence begin?",
  },
  {
    id: "tone",
    optionA: {
      example:
        "Your adult evening program sounds like a strong fit for my background.",
      guidance: "Use warm, plainspoken language.",
      label: "Warm and direct",
    },
    optionB: {
      example:
        "My background aligns well with the requirements of your adult evening program.",
      guidance: "Use polished, restrained language.",
      label: "Polished and restrained",
    },
    prompt: "Which overall tone sounds more like you?",
  },
  {
    id: "detail",
    optionA: {
      example:
        "I’ve taught adults and university students in communicative English classes.",
      guidance: "Use one or two highly relevant supporting facts.",
      label: "Only the strongest facts",
    },
    optionB: {
      example:
        "I’ve taught adults and university students, designed communicative lessons, and supported speaking and exam preparation.",
      guidance:
        "Use several relevant supporting facts when the listing supports them.",
      label: "A little more evidence",
    },
    prompt: "How much supporting detail should a short message carry?",
  },
  {
    id: "paragraphs",
    optionA: {
      example: "Two compact body paragraphs before the question and sign-off.",
      guidance: "Prefer two compact body paragraphs.",
      label: "Two compact paragraphs",
    },
    optionB: {
      example: "Three short body paragraphs, each with one purpose.",
      guidance: "Prefer three short single-purpose body paragraphs.",
      label: "Three short paragraphs",
    },
    prompt: "Which structure is easier to read?",
  },
  {
    id: "availability",
    optionA: {
      example:
        "I’m available to begin in August and can relocate before the term starts.",
      guidance:
        "State supported availability early when it is useful to the employer.",
      label: "Availability early",
    },
    optionB: {
      example: "I’m available to begin in August.",
      guidance: "State supported availability near the close of the message.",
      label: "Availability near the close",
    },
    prompt: "Where should concrete availability appear?",
  },
  {
    id: "question",
    optionA: {
      example:
        "What would the weekly teaching schedule look like for this role?",
      guidance:
        "Ask one concrete operational question that is not answered by the listing.",
      label: "Concrete operational question",
    },
    optionB: {
      example:
        "What are the most important priorities for the teacher in this role?",
      guidance: "Ask one broader question about the employer’s priorities.",
      label: "Broader priorities question",
    },
    prompt: "What kind of final question is most useful?",
  },
  {
    id: "employer_reference",
    optionA: {
      example:
        "Your focus on small adult classes is especially relevant to my experience.",
      guidance:
        "Reference one distinctive, verified detail from the employer or role.",
      label: "Name one specific detail",
    },
    optionB: {
      example: "The position is a good match for my teaching background.",
      guidance:
        "Keep employer references minimal unless a detail is genuinely distinctive.",
      label: "Keep it general",
    },
    prompt: "How specifically should the employer be referenced?",
  },
  {
    id: "brevity",
    optionA: {
      example: "Aim for roughly 110–150 words when the necessary facts fit.",
      guidance: "Prefer approximately 110 to 150 words.",
      label: "Very concise",
    },
    optionB: {
      example: "Use up to roughly 180–210 words when the role needs context.",
      guidance:
        "Allow approximately 180 to 210 words when useful context warrants it.",
      label: "Allow more context",
    },
    prompt: "How short should the finished message feel?",
  },
];

export function messageStyleGuidance(choices: MessageStyleChoices): string[] {
  return messageStyleComparisons.flatMap((comparison) => {
    const choice = choices[comparison.id];
    if (choice === "a") {
      return [comparison.optionA.guidance];
    }
    if (choice === "b") {
      return [comparison.optionB.guidance];
    }
    return [];
  });
}
