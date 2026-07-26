import type { PayPeriodReader } from "../02_extract/pay-period";
import type { RankedCandidate } from "../03_match/candidates";
import { CANDIDATE, type Candidate, disqualifying } from "./candidate";
import { fill, POOLS, pick, seedFrom } from "./variants";

export interface ComposedMessage {
  body: string;
  channel: "email" | "form";
  destination: string;
  jobId: string;
  subject: string;
}

export class UnaddressableListing extends Error {}

const ROLE_NOISE = /\s+[-–—|(].*$/u;
const WHITESPACE = /\s+/gu;
const DECORATION = /[^\p{L}\p{N}\s'&/,.-]/gu;
const MAX_ROLE_LENGTH = 60;
const MAX_CITY_LENGTH = 28;
const INTRODUCTIONS = [
  "My name is {name}. ",
  "I am {name}. ",
  "{name} here. ",
  "",
  "",
  "My name is {name} and I am writing from Arizona. ",
];
const EXPERIENCE = [
  "I have taught English full time in Moscow and in the United States.",
  "I taught English full time for two and a half years in Moscow, and later in Las Vegas.",
  "I spent two and a half years teaching English in Moscow and have since taught adult classes in the United States.",
  "my teaching has been full time English in Moscow and adult ESL in the United States.",
  "I have taught adults and children, in Moscow and in the United States, and online over Zoom.",
];
const TRAILING_COMMA = /,\s*$/u;
const LEADING_SEPARATOR = /^[\s,]+/u;
const LOWER_WORD = /\b\p{Ll}[\p{L}'-]*/gu;

export function roleFrom(title: string): string {
  const cleaned = title
    .replace(DECORATION, " ")
    .replace(ROLE_NOISE, "")
    .replace(WHITESPACE, " ")
    .trim();
  if (cleaned === "" || cleaned.length > MAX_ROLE_LENGTH) {
    return "";
  }
  return cleaned.toLocaleLowerCase("en").startsWith("the ")
    ? cleaned.slice(4)
    : cleaned;
}

export function placeFrom(country: string, location: string): string {
  const nation = country
    .replace(WHITESPACE, " ")
    .replace(TRAILING_COMMA, "")
    .trim();
  let city = location
    .replace(WHITESPACE, " ")
    .replace(TRAILING_COMMA, "")
    .trim();
  const lowerCity = city.toLocaleLowerCase("en");
  const lowerNation = nation.toLocaleLowerCase("en");
  const after = lowerCity.charAt(nation.length);
  if (
    nation &&
    lowerCity.startsWith(lowerNation) &&
    (after === "," || after === "")
  ) {
    city = city.slice(nation.length).replace(LEADING_SEPARATOR, "");
  }
  const parts = city.split(",").filter((part) => part.trim() !== "");
  if (parts.length > 1 && nation) {
    return nation;
  }
  const titled = city.replace(LOWER_WORD, (word) =>
    word.length > 2
      ? word.charAt(0).toLocaleUpperCase("en") + word.slice(1)
      : word
  );
  if (titled.length > MAX_CITY_LENGTH) {
    return nation || titled;
  }
  if (titled && nation) {
    return `${titled}, ${nation}`;
  }
  return titled || nation;
}

const SIGN_CHANNEL = [
  "{channels} available on request",
  "Reachable on {channels}",
  "{channels}",
  "Happy to speak over {channels}",
];

function signature(candidate: Candidate, seed: number): string {
  return [
    candidate.fullName,
    `M | ${candidate.phone}`,
    `E | ${candidate.email}`,
    pick(SIGN_CHANNEL, seed, 10).replace(
      "{channels}",
      candidate.channels.join(" / ")
    ),
  ].join("\n");
}

export function composeMessage(
  entry: RankedCandidate,
  candidate: Candidate = CANDIDATE,
  readRoleAs?: string
): ComposedMessage {
  const { listing, route } = entry;
  if (!route) {
    throw new UnaddressableListing(`${listing.id} has no application route`);
  }
  const blocked = disqualifying(
    listing.restrictions,
    listing.country,
    candidate
  );
  if (blocked.length > 0) {
    throw new UnaddressableListing(`${listing.id} is ${blocked.join(", ")}`);
  }
  const role = readRoleAs ?? roleFrom(listing.title);
  const place = placeFrom(listing.country, listing.location);
  if (role === "" || place === "") {
    throw new UnaddressableListing(
      `${listing.id} has no usable role or place: title="${listing.title}" country="${listing.country}"`
    );
  }
  const values = { place, role };
  const seed = seedFrom(listing.id);
  const experience = pick(EXPERIENCE, seed, 8);
  const credential = `${pick(POOLS.credentials, seed, 3)}, and ${experience}`;
  const intro = pick(INTRODUCTIONS, seed, 9).replace(
    "{name}",
    candidate.shortName
  );
  const openLine = `${intro}${fill(pick(POOLS.interests, seed, 2), values)}`;
  const attach =
    route.kind === "email"
      ? pick(POOLS.attachments, seed, 4)
      : pick(POOLS.formClosers, seed, 4);
  const middle =
    seed % 2 === 0 ? [credential, "", attach] : [attach, "", credential];
  const body = [
    pick(POOLS.openings, seed, 1),
    "",
    openLine,
    "",
    ...middle,
    "",
    fill(pick(POOLS.closings, seed, 5), values),
    "",
    pick(POOLS.signoffs, seed, 6),
    "",
    signature(candidate, seed),
  ].join("\n");
  return {
    body,
    channel: route.kind === "email" ? "email" : "form",
    destination: route.destination,
    jobId: listing.id,
    subject: fill(pick(POOLS.subjects, seed, 7), values),
  };
}
export const ROLE_INSTRUCTIONS = `You turn a job advert title into the plain name of the role.

Reply with JSON only: {"role":"..."}

Rules:
- Use only words that appear in the title. Do not add words.
- Give the role alone: no country, no city, no school name, no salary, no "wanted", "needed", "urgent", "required", "immediate start", no dates.
- Give a singular noun phrase. Never include the words "job", "position", "vacancy", "opening" or "role" - those are added later.
- Keep it under five words.
- If the title names no teachable role, reply {"role":""}.

Examples:
"Nanny/Governess job for B2 in Tatarstan (Russia)" -> {"role":"nanny/governess"}
"NES Homeroom English Teacher (Aug 2026)" -> {"role":"homeroom English teacher"}
"MATHS, SCIENCE & ENGLISH TEACHERS REQUIRED IN DOHA" -> {"role":"maths, science and English teacher"}
"Teach English in Vietnam!" -> {"role":"English teacher"}
"Full Time English Teaching Positions" -> {"role":"English teacher"}
"ESL Teaching in San Jose, Costa Rica" -> {"role":"ESL teacher"}
"Teachers Needed Urgently" -> {"role":"teacher"}`;

const ROLE_JSON = /\{[\s\S]*\}/u;
const WORD = /[\p{L}\p{N}]+/gu;
const MAX_ROLE_WORDS = 6;
const BANNED_ROLE_WORDS =
  /\b(job|position|vacancy|opening|role|wanted|needed|urgent|required)\b/iu;
const STEM_LENGTH = 5;
const PLURAL = /s$/u;

export function roleWordsAreInTitle(role: string, title: string): boolean {
  const allowed = new Set(
    (title.toLocaleLowerCase("en").match(WORD) ?? []).flatMap((word) => [
      word,
      word.replace(PLURAL, ""),
      `${word}s`,
    ])
  );
  if (BANNED_ROLE_WORDS.test(role)) {
    return false;
  }
  const words = role.toLocaleLowerCase("en").match(WORD) ?? [];
  if (words.length === 0 || words.length > MAX_ROLE_WORDS) {
    return false;
  }
  const stems = [...allowed].map((word) => word.slice(0, STEM_LENGTH));
  return words.every(
    (word) =>
      allowed.has(word) ||
      word === "and" ||
      stems.includes(word.slice(0, STEM_LENGTH))
  );
}

export async function readRole(
  title: string,
  reader: PayPeriodReader
): Promise<string | null> {
  const response = await fetch(`${reader.baseUrl}/chat/completions`, {
    body: JSON.stringify({
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 80,
      messages: [
        { content: ROLE_INSTRUCTIONS, role: "system" },
        { content: title, role: "user" },
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
  const found = ROLE_JSON.exec(payload.choices?.[0]?.message?.content ?? "");
  if (!found) {
    return null;
  }
  try {
    const { role } = JSON.parse(found[0]) as { role?: unknown };
    if (typeof role !== "string" || role.trim() === "") {
      return null;
    }
    const trimmed = role.trim();
    return roleWordsAreInTitle(trimmed, title) ? trimmed : null;
  } catch {
    return null;
  }
}
