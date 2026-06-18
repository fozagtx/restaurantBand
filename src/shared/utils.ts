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
  return unique([...text.matchAll(phonePattern)].map((match) => match[0]));
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
