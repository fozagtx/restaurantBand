export const aggregatorDomains = [
  "yelp.com",
  "tripadvisor.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "opentable.com",
  "resy.com",
  "toasttab.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "foursquare.com",
  "seamless.com"
];

const socialDomains = new Set(["instagram.com", "facebook.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com"]);
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;

export function cleanDomain(url: string): string {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

export function isAggregator(url: string): boolean {
  const domain = cleanDomain(url);
  return aggregatorDomains.some((bad) => domain === bad || domain.endsWith(`.${bad}`));
}

export function isSocialUrl(url: string): boolean {
  const domain = cleanDomain(url);
  return [...socialDomains].some((social) => domain === social || domain.endsWith(`.${social}`));
}

export function unique<T>(values: Iterable<T>, key: (value: T) => string = String): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const normalized = key(value).trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(value);
  }
  return output;
}

export function extractEmails(text: string): string[] {
  const blocked = ["example.com", "domain.com", "email.com", "sentry.io", "wixpress.com"];
  return unique([...text.matchAll(emailPattern)].map((match) => match[0]).filter((email) => !blocked.some((token) => email.toLowerCase().includes(token))));
}

export function extractPhones(text: string): string[] {
  const phones: string[] = [];
  for (const match of text.matchAll(phonePattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    const line = lineAround(text, index);
    if (/\bhttps?:|www\.|\.jpe?g\b|\.png\b|\.webp\b|wp-content|uploads|image|asset/i.test(line)) continue;
    const digits = value.replace(/\D/g, "");
    const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (normalizedDigits.length !== 10) continue;
    if (/^(\d)\1{9}$/.test(normalizedDigits)) continue;
    const context = text.slice(Math.max(0, index - 32), Math.min(text.length, index + value.length + 32)).toLowerCase();
    const hasPhoneContext = /\b(phone|tel|call|text|mobile|contact|sms)\b/.test(context);
    const hasHumanFormatting = /[().\s-]/.test(value.replace(/^\+?1/, ""));
    if (!hasHumanFormatting && !hasPhoneContext) continue;
    phones.push(value);
  }
  return unique(phones, (phone) => phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""));
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index);
  const end = text.indexOf("\n", index);
  return text.slice(start === -1 ? 0 : start + 1, end === -1 ? text.length : end);
}

export function inferRestaurantName(title: string, domain: string): string {
  let cleaned = title.replace(/\s+/g, " ").trim();
  for (const separator of [" | ", " - ", " — ", " – ", ":"]) {
    if (cleaned.includes(separator)) cleaned = cleaned.split(separator)[0]?.trim() ?? cleaned;
  }
  cleaned = cleaned.replace(/\b(official site|official website|menu|home|restaurant)\b/gi, "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.slice(0, 80);
  return domain.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) ?? domain;
}

export function maybeMenuUrl(url: string, title: string, text: string): boolean {
  const haystack = `${url} ${title} ${text}`.toLowerCase();
  return ["menu", "order", "dishes", "food", "gallery"].some((token) => haystack.includes(token));
}

export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant";
}

export function nowIso(): string {
  return new Date().toISOString();
}
