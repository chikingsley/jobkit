import type { AppEnv } from "./env";
import type { JobImport } from "./schemas";

const credentials =
  "I am a TEFL-certified educator with more than four years of English-teaching experience in the United States and Russia. I have taught adults, children, teenagers, and mixed-proficiency classes from pre-intermediate through advanced levels, both in person and online. My experience includes communicative lesson planning, grammar and speaking instruction, student assessment, classroom management, and adapting lessons to different learner needs. I also hold current Arizona education credentials in adult education, substitute teaching, and secondary chemistry.";

function interestFor(job: JobImport): string {
  const text = `${job.title} ${job.description}`.toLowerCase();
  if (
    job.title.toLowerCase().includes("lecturer") ||
    text.includes("college students") ||
    text.includes("university students")
  ) {
    return "the focus on adult learners and academic English";
  }
  if (
    text.includes("biology") ||
    text.includes("science") ||
    text.includes("chemistry")
  ) {
    return "the chance to draw on both my teaching experience and my background in biology and chemistry";
  }
  if (text.includes("children to adults") || text.includes("different age")) {
    return "the opportunity to work with students across different ages and levels";
  }
  if (
    text.includes("child") ||
    text.includes("young") ||
    text.includes("elementary")
  ) {
    return "the focus on younger learners and engaging, well-structured lessons";
  }
  if (text.includes("ielts") || text.includes("exam")) {
    return "the program's focus on purposeful language instruction and learner progress";
  }
  return "the emphasis on practical teaching and building a good rapport with students";
}

function questionFor(job: JobImport): string {
  const description = job.description.toLowerCase();
  const statedStart =
    /start date\s*:/i.test(job.description) ||
    /immediate(?:ly)?(?: start| available| !)/i.test(job.description) ||
    /\b(?:august|september|october|november|december|january|february|march|april|may|june|july)(?:\s+\d{1,2},?)?\s+20\d{2}\b/i.test(
      job.description
    ) ||
    description.includes("beginning august 2026");
  if (statedStart) {
    return "Could you tell me more about the expected teaching schedule and student groups?";
  }
  return "Could you tell me more about the expected teaching schedule and anticipated start date?";
}

export function fallbackDraft(job: JobImport): {
  message: string;
  summary: string;
} {
  const school = job.company || "your school";
  const schoolInSentence = school.replace(/[.!?]+$/, "");
  const place = job.country || job.location || "the position's location";
  const message = [
    "Hello,",
    `My name is Chibuzor, but I go by Simon. I am interested in teaching in ${place}, and I liked the description of the position${job.company ? ` at ${schoolInSentence}` : ""}. I was particularly interested in ${interestFor(job)}.`,
    credentials,
    questionFor(job),
    "I look forward to hearing from you.\n\nBest,\nSimon Ejimofor",
  ].join("\n\n");
  const summary = `Named ${place}${job.company ? ` and ${school}` : ""}; highlighted ${interestFor(job)}; asked about the schedule and start details without repeating the listing title.`;
  return { message, summary };
}

export async function reviseWithModel(
  env: AppEnv,
  job: JobImport,
  current: string,
  instruction: string
): Promise<{ message: string; summary: string }> {
  if (!(env.SUPERWHISPER_API_BASE && env.SUPERWHISPER_API_KEY)) {
    return reviseDeterministically(current, instruction);
  }
  try {
    const response = await fetch(
      `${env.SUPERWHISPER_API_BASE.replace(/\/$/, "")}/v1/text/generate`,
      {
        body: JSON.stringify({
          max_tokens: 900,
          messages: [
            {
              content: `Revise this job application message using the user's instruction. Preserve only truthful claims, first-person voice, a concise open-ended question, and the exact signature. Return JSON with message and changeSummary.\n\nJob: ${JSON.stringify(job)}\n\nCurrent message:\n${current}\n\nInstruction: ${instruction}`,
              role: "user",
            },
          ],
          model: "claude-sonnet-4-6",
        }),
        headers: {
          authorization: `Bearer ${env.SUPERWHISPER_API_KEY}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error(`Draft model returned ${response.status}`);
    }
    const payload = (await response.json()) as { text?: string };
    const raw = payload.text?.trim() ?? "";
    const jsonText = raw
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(jsonText) as {
      message?: string;
      changeSummary?: string;
    };
    if (!parsed.message?.includes("Simon Ejimofor")) {
      throw new Error("Revised draft omitted the signature");
    }
    return {
      message: parsed.message,
      summary: parsed.changeSummary || instruction,
    };
  } catch {
    return reviseDeterministically(current, instruction);
  }
}

function reviseDeterministically(
  current: string,
  instruction: string
): { message: string; summary: string } {
  let message = current;
  const lowered = instruction.toLowerCase();
  if (lowered.includes("schedule") && lowered.includes("start date")) {
    message = message.replace(
      /Could you tell me[^?]+\?/,
      "Could you tell me more about the expected teaching schedule and anticipated start date?"
    );
  }
  if (lowered.includes("remove contract terms")) {
    message = message.replace(/contract terms,?\s*/gi, "");
  }
  return {
    message,
    summary:
      message === current
        ? `Saved revision instruction for review: ${instruction}`
        : `Applied revision: ${instruction}`,
  };
}
