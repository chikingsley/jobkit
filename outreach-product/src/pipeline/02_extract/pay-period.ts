import { readFileSync } from "node:fs";
import { MONTHLY_FX_TO_USD } from "./currency";
export const PAY_PERIODS = [
  "hour",
  "day",
  "week",
  "fortnight",
  "month",
  "year",
  "contract",
] as const;

export type PayPeriod = (typeof PAY_PERIODS)[number];

export interface PayPeriodQuestion {
  body: string;
  country: string;
  salary: string;
}

export interface PayPeriodReading {
  evidence: string;
  period: PayPeriod;
}

export interface PayPeriodReader {
  baseUrl: string;
  key: string;
  maxTokens: number;
  model: string;
  timeoutMs: number;
}

export const CONFIDENT_MONTHLY_FLOOR_USD = 400;
export const CONFIDENT_MONTHLY_CEILING_USD = 9000;
const BODY_LIMIT = 2600;
const NORMALISE = /[\s ]+/gu;
const JSON_OBJECT = /\{[\s\S]*\}/u;

export const PAY_PERIOD_INSTRUCTIONS = `You read one job advert and decide what time period its stated salary covers.

Reply with JSON only: {"period":"hour"|"week"|"month"|"year"|"unknown","quote":"..."}

Rules:
- "quote" must be text copied exactly from the advert that shows the period. If nothing states or clearly implies it, answer "unknown" with an empty quote.
- A period attached to a benefit is not the salary period. "annual flight", "yearly return ticket", "one flight per year" and "36 days holiday per year" say nothing about salary.
- A payment frequency does count: "paid every 15th and 30th" means month.
- Consider the size of the figure for that country. A very small amount paid to a teacher is an hourly or per-lesson rate, not a monthly wage.`;

export function needsPeriodReading(monthlyUsd: number): boolean {
  return (
    monthlyUsd < CONFIDENT_MONTHLY_FLOOR_USD ||
    monthlyUsd > CONFIDENT_MONTHLY_CEILING_USD
  );
}

function comparable(value: string) {
  return value.replace(NORMALISE, " ").trim().toLocaleLowerCase("en");
}

export function quoteIsGrounded(quote: string, question: PayPeriodQuestion) {
  const needle = comparable(quote);
  if (needle === "") {
    return false;
  }
  const haystack = comparable(`${question.salary} ${question.body}`);
  return haystack.includes(needle);
}

const PERIOD_EVIDENCE =
  /per\s+(hour|lesson|class|day|week|fortnight|month|year|annum|contract)|\/\s*(hr|hour|day|wk|week|mo|month|yr|year)\b|hourly|daily|weekly|monthly|yearly|annual|annually|a\s+(day|month|week|year)|an\s+hour|every\s+\d|\d+(st|th)\s+(and|&)/iu;

const BENEFIT_CONTEXT =
  /stipend|allowance|bonus|ticket|flight|airfare|holiday|vacation|insurance|reimburse|gratuity|pension|utilities|deposit/iu;

export function quoteShowsPayPeriod(quote: string) {
  return PERIOD_EVIDENCE.test(quote) && !BENEFIT_CONTEXT.test(quote);
}

function parseReply(
  reply: string,
  question: PayPeriodQuestion
): PayPeriodReading | null {
  const json = JSON_OBJECT.exec(reply);
  if (!json) {
    return null;
  }
  let parsed: { period?: unknown; quote?: unknown };
  try {
    parsed = JSON.parse(json[0]);
  } catch {
    return null;
  }
  const period = PAY_PERIODS.find((known) => known === parsed.period);
  if (!period) {
    return null;
  }
  const quote = typeof parsed.quote === "string" ? parsed.quote.trim() : "";
  if (!(quoteIsGrounded(quote, question) && quoteShowsPayPeriod(quote))) {
    return null;
  }
  return { evidence: quote, period };
}

export async function readPayPeriod(
  question: PayPeriodQuestion,
  reader: PayPeriodReader
): Promise<PayPeriodReading | null> {
  const response = await fetch(`${reader.baseUrl}/chat/completions`, {
    body: JSON.stringify({
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: reader.maxTokens,
      messages: [
        { content: PAY_PERIOD_INSTRUCTIONS, role: "system" },
        {
          content: `Country: ${question.country}\nStated salary: ${question.salary}\nAdvert: ${question.body.slice(0, BODY_LIMIT)}`,
          role: "user",
        },
      ],
      model: reader.model,
      temperature: 0,
    }),
    headers: {
      authorization: `Bearer ${reader.key}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(reader.timeoutMs),
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = payload.choices?.[0]?.message?.content ?? "";
  return parseReply(reply, question);
}

export const DEFAULT_READER: PayPeriodReader = {
  baseUrl: "http://127.0.0.1:8030/v1",
  key: "",
  maxTokens: 250,
  model: "qwen35-9b-ud-q4-k-xl",
  timeoutMs: 120_000,
};

export const DEFAULT_KEY_FILE =
  "/home/simon/docker/llamacpp-llm/secrets/llamacpp-api-key";

export interface PeriodQuestion {
  amount: number;
  body: string;
  country: string;
  currency: string;
  id: string;
  salary: string;
}

export interface PeriodResolution {
  evidence: string;
  period: PayPeriod;
}

export function readerFromKeyFile(path = DEFAULT_KEY_FILE): PayPeriodReader {
  return { ...DEFAULT_READER, key: readFileSync(path, "utf8").trim() };
}

export function needsResolving(amount: number, currency: string) {
  const rate = MONTHLY_FX_TO_USD[currency];
  return rate ? needsPeriodReading(amount * rate) : false;
}

const CONCURRENCY = 4;

async function readChunk(
  chunk: PeriodQuestion[],
  reader: PayPeriodReader
): Promise<[string, PeriodResolution][]> {
  const readings = await Promise.all(
    chunk.map((question) =>
      readPayPeriod(
        {
          body: question.body,
          country: question.country,
          salary: question.salary,
        },
        reader
      ).then((reading) => [question.id, reading] as const)
    )
  );
  return readings.flatMap(([id, reading]) =>
    reading ? [[id, reading] as [string, PeriodResolution]] : []
  );
}

export async function resolvePeriods(
  questions: PeriodQuestion[],
  reader: PayPeriodReader,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, PeriodResolution>> {
  const chunks: PeriodQuestion[][] = [];
  for (let start = 0; start < questions.length; start += CONCURRENCY) {
    chunks.push(questions.slice(start, start + CONCURRENCY));
  }
  const resolved = new Map<string, PeriodResolution>();
  let done = 0;
  for (const chunk of chunks) {
    for (const [id, reading] of await readChunk(chunk, reader)) {
      resolved.set(id, reading);
    }
    done += chunk.length;
    onProgress?.(done, questions.length);
  }
  return resolved;
}
