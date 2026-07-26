export interface VariantPools {
  attachments: string[];
  closings: string[];
  credentials: string[];
  formClosers: string[];
  interests: string[];
  openings: string[];
  signoffs: string[];
  subjects: string[];
}

export const POOLS: VariantPools = {
  attachments: [
    "My resume, degree and TEFL certificate are attached.",
    "I have attached my resume along with my degree and TEFL certificate.",
    "Resume, degree and TEFL certificate are attached for your review.",
    "I attached my resume, degree and TEFL certificate; I can send anything else you need.",
    "My resume is attached, together with my degree and TEFL certificate.",
    "You will find my resume, degree and TEFL certificate attached.",
    "Attached are my resume, my degree and my TEFL certificate.",
    "I have sent my resume, degree and TEFL certificate with this message.",
  ],
  closings: [
    "Is your school still taking applications for the {role} position?",
    "Are you still hiring for the {role} position this term?",
    "Is the {role} position still open?",
    "Would you still like applications for the {role} position?",
    "Are you still looking to fill the {role} position?",
    "Is this position still available for the coming term?",
    "Has the {role} position been filled yet?",
    "Are you still accepting applications for this role?",
  ],
  credentials: [
    "I am TEFL certified with a bachelor's degree",
    "I hold a 240-hour TEFL certificate and a bachelor's degree",
    "I am a TEFL-certified teacher with a bachelor's degree",
    "I have a bachelor's degree and a 240-hour TEFL certificate",
    "I am TEFL certified and hold a bachelor's degree",
    "I carry a 240-hour TEFL certificate alongside my bachelor's degree",
    "I finished a 240-hour TEFL certificate after my bachelor's degree",
    "My background is a bachelor's degree plus a 240-hour TEFL certificate",
  ],
  formClosers: [
    "Happy to answer any questions about my resume or certificates.",
    "If anything in my profile needs clarifying, just ask.",
    "Glad to go into more detail on my experience or certificates if useful.",
    "Ask me anything about my background or qualifications.",
    "I can expand on any part of my experience you want to know more about.",
    "Let me know if you would like more detail on my teaching background.",
  ],
  interests: [
    "I saw your posting for a {role} in {place} and would like to be considered.",
    "Your {role} posting in {place} caught my eye and I would like to apply.",
    "I came across your {role} opening in {place} and am interested in the role.",
    "I read your listing for a {role} in {place} and would like to put my name forward.",
    "I would like to apply for the {role} position you have posted in {place}.",
    "I am writing about the {role} role you advertised in {place}.",
    "Your listing for a {role} in {place} looks like a good fit for me.",
  ],
  openings: [
    "Hello,",
    "Good morning,",
    "Hi there,",
    "Hello there,",
    "Good day,",
    "Dear hiring team,",
    "Hello, and thanks for your time,",
  ],
  signoffs: [
    "Thanks,",
    "Thank you,",
    "Best regards,",
    "Many thanks,",
    "Best,",
    "Kind regards,",
    "Thanks very much,",
    "With thanks,",
  ],
  subjects: [
    "{role} - {place}",
    "Application: {role} in {place}",
    "{role} position, {place}",
    "Applying for {role} - {place}",
    "{place} {role} - application",
    "Interested in your {role} opening in {place}",
  ],
};

const SEED_PRIME = 2_166_136_261;
const SEED_MULTIPLIER = 16_777_619;
const SEED_MODULUS = 4_294_967_296;

export function seedFrom(value: string): number {
  let hash = SEED_PRIME;
  for (const character of value) {
    hash = (hash + (character.codePointAt(0) ?? 0)) % SEED_MODULUS;
    hash = (hash * 31) % SEED_MODULUS;
  }
  return hash;
}

export function pick<Item>(pool: Item[], seed: number, salt: number): Item {
  let mixed = (seed + salt * SEED_PRIME) % SEED_MODULUS;
  mixed = (mixed * SEED_MULTIPLIER) % SEED_MODULUS;
  mixed = (mixed + Math.floor(mixed / pool.length)) % SEED_MODULUS;
  const chosen = pool[mixed % pool.length];
  if (chosen === undefined) {
    throw new Error("cannot pick from an empty pool");
  }
  return chosen;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(SLOT, (_whole, key: string) => {
    const value = values[key];
    if (value === undefined || value.trim() === "") {
      throw new Error(`no value for {${key}}`);
    }
    return value;
  });
}

const SLOT = /\{(\w+)\}/gu;
const TOKEN = /[a-z']+/gu;

export function similarity(first: string, second: string): number {
  const left = new Set(first.toLocaleLowerCase("en").match(TOKEN) ?? []);
  const right = new Set(second.toLocaleLowerCase("en").match(TOKEN) ?? []);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}
