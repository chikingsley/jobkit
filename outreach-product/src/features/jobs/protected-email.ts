const CLOUDFLARE_EMAIL_ATTRIBUTE_PATTERN =
  /data-cfemail\s*=\s*["']([0-9a-f]+)["']/giu;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const HEX_PATTERN = /^[0-9a-f]+$/iu;
const PROTECTED_EMAIL_PATTERN = /\[email(?:[\s\u00a0]|&#160;)+protected\]/giu;

export interface ProtectedEmailPart {
  kind: "placeholder" | "text";
  offset: number;
  value: string;
}

export function decodeCloudflareEmail(encoded: string): string | null {
  const normalized = encoded.trim();
  if (
    normalized.length < 4 ||
    normalized.length % 2 !== 0 ||
    !HEX_PATTERN.test(normalized)
  ) {
    return null;
  }
  const key = Number.parseInt(normalized.slice(0, 2), 16);
  const bytes: number[] = [];
  for (let offset = 2; offset < normalized.length; offset += 2) {
    // biome-ignore lint/suspicious/noBitwiseOperators: Cloudflare's documented email protection encoding XORs every payload byte with the first byte.
    bytes.push(Number.parseInt(normalized.slice(offset, offset + 2), 16) ^ key);
  }
  const decoded = new TextDecoder().decode(new Uint8Array(bytes));
  return EMAIL_PATTERN.test(decoded) ? decoded.toLowerCase() : null;
}

export function cloudflareEmailsFromHtml(value: string) {
  const emails = new Set<string>();
  for (const match of value.matchAll(CLOUDFLARE_EMAIL_ATTRIBUTE_PATTERN)) {
    const decoded = decodeCloudflareEmail(match[1] ?? "");
    if (decoded) {
      emails.add(decoded);
    }
  }
  return [...emails];
}

export function protectedEmailParts(value: string): ProtectedEmailPart[] {
  const parts: ProtectedEmailPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(PROTECTED_EMAIL_PATTERN)) {
    const offset = match.index;
    if (offset > cursor) {
      parts.push({
        kind: "text",
        offset: cursor,
        value: value.slice(cursor, offset),
      });
    }
    parts.push({ kind: "placeholder", offset, value: match[0] });
    cursor = offset + match[0].length;
  }
  if (cursor < value.length) {
    parts.push({ kind: "text", offset: cursor, value: value.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ kind: "text", offset: 0, value }];
}
