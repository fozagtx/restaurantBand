import { loadConfig, type RuntimeConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import { capLeadLimit, requestedLimitNote } from "../shared/leadPolicy.js";
import type { CandidateLead, CandidateResearchPacket, ContactPerson, SourceEvidence } from "../shared/schemas.js";
import {
  aggregatorDomains,
  cleanDomain,
  extractEmails,
  extractPhones,
  inferRestaurantName,
  isAggregator,
  isSocialUrl,
  maybeMenuUrl,
  nowIso,
  truncate,
  unique
} from "../shared/utils.js";

const exaSearchUrl = "https://api.exa.ai/search";
const socialSearchDomains = ["instagram.com", "facebook.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com"];

type ExaRawResult = {
  title?: string;
  url?: string;
  id?: string;
  text?: string;
  highlights?: string[] | string;
  image?: string;
};

type ExaSearchResponse = {
  results?: ExaRawResult[];
};

type ExaResult = {
  title: string;
  url: string;
  text: string;
  highlights: string[];
  image?: string;
};

type ExaSearchType = "fast" | "auto" | "deep" | "deep-reasoning";
type WebsiteValidation = {
  ok: boolean;
  reason: string;
  finalUrl?: string;
};

export class ExaResearchClient {
  private readonly config: RuntimeConfig;
  requestCount = 0;

  constructor(config = loadConfig({ requireExa: true })) {
    this.config = config;
    if (!this.config.exaApiKey) {
      throw new Error("EXA_API_KEY is required. The app never creates mock restaurant leads.");
    }
  }

  async search(query: string, options: { numResults?: number; includeDomains?: string[]; excludeDomains?: string[]; exaSearchType: ExaSearchType }): Promise<ExaResult[]> {
    const payload: Record<string, unknown> = {
      query,
      type: options.exaSearchType,
      numResults: options.numResults ?? this.config.exaNumResults,
      contents: {
        highlights: true,
        text: { maxCharacters: 1800 }
      },
      moderation: true
    };

    if (options.includeDomains?.length) {
      payload.includeDomains = options.includeDomains;
    } else if (options.excludeDomains) {
      payload.excludeDomains = options.excludeDomains;
    } else {
      payload.excludeDomains = aggregatorDomains;
    }

    this.requestCount += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch(exaSearchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.exaApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      throw new Error(`Exa search request failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Exa search failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as ExaSearchResponse;
    return (data.results ?? [])
      .map(normalizeExaResult)
      .filter((result): result is ExaResult => Boolean(result?.url));
  }
}

export async function findRestaurantCandidates(input: {
  location: string;
  cuisine: string;
  limit: number;
  searchMode: "quick" | "smart" | "deep";
  exaSearchType: ExaSearchType;
  config?: RuntimeConfig;
}): Promise<CandidateResearchPacket> {
  const config = input.config ?? loadConfig({ requireExa: true });
  const targetLimit = capLeadLimit(input.limit);
  const notes: string[] = [];
  const limitNote = requestedLimitNote(input.limit);
  if (limitNote) notes.push(limitNote);
  const client = new ExaResearchClient(config);
  const query = [
    `Independent ${input.cuisine} restaurants in ${input.location}`,
    "official websites menus food photos contact email catering ordering pages",
    "under-marketed restaurant websites simple menu pages old gallery pages weak food photography"
  ].join(" ");

  const rawResults = await client.search(query, {
    numResults: Math.max(config.exaNumResults, targetLimit * 8),
    exaSearchType: input.exaSearchType
  });

  const grouped = new Map<string, ExaResult[]>();
  for (const result of rawResults) {
    if (!result.url || isAggregator(result.url)) continue;
    const domain = cleanDomain(result.url);
    grouped.set(domain, [...(grouped.get(domain) ?? []), result]);
  }

  const leads: CandidateLead[] = [];
  let skippedUnqualified = 0;
  for (const [domain, domainResults] of grouped) {
    if (leads.length >= targetLimit) break;
    const primary = domainResults[0];
    if (!primary) continue;
    const name = inferRestaurantName(primary.title, domain);
    const websiteValidation = await validateOfficialWebsite(primary.url, name);
    if (!websiteValidation.ok) {
      skippedUnqualified += 1;
      notes.push(`Skipped ${name}: ${websiteValidation.reason}`);
      continue;
    }
    const contactResults = await client.search(
      `${name} ${input.location} restaurant contact email menu food photos official website catering owner`,
      { numResults: input.searchMode === "deep" ? 6 : 4, includeDomains: [domain], exaSearchType: input.exaSearchType }
    );
    const socialResults = await optionalSearch(
      client,
      `${name} ${input.location} restaurant Instagram Facebook TikTok X Twitter LinkedIn owner chef founder`,
      { numResults: input.searchMode === "deep" ? 8 : 5, excludeDomains: [], exaSearchType: input.exaSearchType }
    );
    const peopleResults = await optionalSearch(
      client,
      `${name} ${input.location} restaurant owner founder chef manager contact name`,
      { numResults: input.searchMode === "deep" ? 8 : 5, exaSearchType: input.exaSearchType }
    );
    const allResults = unique([...domainResults, ...contactResults, ...socialResults, ...peopleResults], (result) => result.url);
    const flatText = allResults.map((result) => [result.title, result.url, result.text, ...result.highlights].join("\n")).join("\n\n");
    const contactText = allResults.map((result) => [result.title, result.text, ...result.highlights].join("\n")).join("\n\n");
    const emails = extractEmails(contactText);
    const phones = extractPhones(contactText);
    const contactPeople = extractContactPeople(allResults);
    const menuUrls = unique(allResults.filter((result) => maybeMenuUrl(result.url, result.title, result.text)).map((result) => result.url));
    const socialUrls = unique(allResults.filter((result) => isSocialUrl(result.url)).map((result) => result.url));
    const imageUrls = unique(allResults.flatMap((result) => (result.image ? [result.image] : [])));
    const sourceUrls = unique(allResults.map((result) => result.url));
    const evidence: SourceEvidence[] = allResults.slice(0, 5).map((result) => ({
      title: result.title,
      url: result.url,
      highlights: result.highlights.slice(0, 3),
      textExcerpt: truncate(result.text.replace(/\s+/g, " "), 500),
      ...(result.image ? { imageUrl: result.image } : {})
    }));
    const lead: CandidateLead = {
      name,
      website: websiteValidation.finalUrl ?? primary.url,
      domain: cleanDomain(websiteValidation.finalUrl ?? primary.url),
      location: input.location,
      cuisine: input.cuisine,
      emails,
      phones,
      contactPeople,
      menuUrls,
      socialUrls,
      imageUrls,
      sourceUrls,
      evidence
    };
    if (isQualifiedCandidate(lead)) {
      leads.push(lead);
    } else {
      skippedUnqualified += 1;
    }
  }

  if (skippedUnqualified) {
    notes.push(`Skipped ${skippedUnqualified} candidate websites that lacked a usable contact path or visual/menu evidence.`);
  }
  if (leads.length < targetLimit) {
    notes.push(`Qualified candidates found for this request: ${leads.length}. The workflow keeps the batch strict and skips weak leads.`);
  }

  return {
    type: "candidate_research_packet",
    location: input.location,
    cuisine: input.cuisine,
    searchMode: input.searchMode,
    exaSearchType: input.exaSearchType,
    generatedAt: nowIso(),
    exaRequestCount: client.requestCount,
    leads,
    notes: leads.length ? notes : [...notes, "Exa returned zero qualified official restaurant websites for this query."],
    collaborationLog: [
      action(
        "Lead Scout",
        "exa_candidate_search",
        `Found ${leads.length} qualified candidate restaurant websites using Exa ${input.exaSearchType} mode, capped at ${targetLimit} for full downstream delivery.`
      )
    ]
  };
}

function isQualifiedCandidate(lead: CandidateLead): boolean {
  const hasContactPath = lead.emails.length > 0 || lead.phones.length > 0 || lead.sourceUrls.some((url) => isOfficialContactUrl(url, lead.domain));
  const hasPitchEvidence = lead.imageUrls.length > 0 || lead.menuUrls.length > 0;
  return hasContactPath && hasPitchEvidence;
}

function isOfficialContactUrl(url: string, domain: string): boolean {
  try {
    return cleanDomain(url) === domain && /\b(contact|about|team|owner|chef|catering|events)\b/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function validateOfficialWebsite(url: string, expectedName: string): Promise<WebsiteValidation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "restaura/0.1 website-validator" },
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: `official website load failed (${response.status})` };
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) return { ok: false, reason: `official website returned ${contentType || "non-HTML content"}` };
    const html = await response.text();
    const reason = rejectWebsiteReason(html, response.url, expectedName);
    if (reason) return { ok: false, reason };
    return { ok: true, reason: "loaded", finalUrl: response.url };
  } catch (error) {
    return { ok: false, reason: `official website fetch failed: ${error instanceof Error ? error.name : String(error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

function rejectWebsiteReason(html: string, url: string, expectedName: string): string | null {
  const lower = html.toLowerCase();
  if (lower.includes('name="robots" content="noindex"') && /\b(coming soon|under construction|check back|parking page)\b/.test(lower)) {
    return "official website is a noindex coming-soon/under-construction page";
  }
  if (/\b(coming soon|under construction|domain for sale|this domain is parked|please check back for an update soon)\b/.test(lower)) {
    return "official website appears to be parked or under construction";
  }
  if (lower.includes("squarespace-logo") && lower.includes("parking-page")) {
    return "official website is a Squarespace parking page";
  }
  const visibleText = stripTags(html).trim();
  if (visibleText.length < 500) {
    return `official website has too little visible content (${url})`;
  }
  const brandTokens = brandIdentityTokens(expectedName);
  const domain = cleanDomain(url).replace(/[^a-z0-9]/g, " ");
  const searchable = `${visibleText} ${domain}`.toLowerCase();
  if (brandTokens.length && !brandTokens.some((token) => searchable.includes(token))) {
    return `official website content mismatches candidate name "${expectedName}"`;
  }
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function brandIdentityTokens(name: string): string[] {
  const blocked = new Set(["restaurant", "restaurants", "catering", "food", "truck", "menu", "official", "site", "home", "austin", "tx", "texas"]);
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !blocked.has(token))
    .slice(0, 4);
}

function normalizeExaResult(raw: ExaRawResult): ExaResult | null {
  const url = raw.url ?? raw.id ?? "";
  if (!url) return null;
  const highlights = Array.isArray(raw.highlights) ? raw.highlights : raw.highlights ? [raw.highlights] : [];
  return {
    title: raw.title ?? "",
    url,
    text: raw.text ?? "",
    highlights: highlights.map(String),
    ...(raw.image ? { image: raw.image } : {})
  };
}

async function optionalSearch(
  client: ExaResearchClient,
  query: string,
  options: { numResults?: number; includeDomains?: string[]; excludeDomains?: string[]; exaSearchType: ExaSearchType }
): Promise<ExaResult[]> {
  try {
    return await client.search(query, options);
  } catch (error) {
    console.warn(`[Lead Scout] optional Exa enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function extractContactPeople(results: ExaResult[]): ContactPerson[] {
  const people: ContactPerson[] = [];
  const roleWords = "(owner|co-owner|founder|co-founder|chef|executive chef|head chef|general manager|manager|operator|partner)";
  const namePattern = "([A-Z][a-zA-Z'.-]+(?:\\s+[A-Z][a-zA-Z'.-]+){1,3})";
  const patterns = [
    new RegExp(`${roleWords}\\s*(?:is|:|-|,)?\\s*${namePattern}`, "gi"),
    new RegExp(`${namePattern}\\s*(?:,|-|is)?\\s*${roleWords}`, "gi"),
    new RegExp(`owned by\\s*${namePattern}`, "gi"),
    new RegExp(`founded by\\s*${namePattern}`, "gi")
  ];

  for (const result of results) {
    const text = [result.title, result.text, ...result.highlights].join(" ").replace(/\s+/g, " ");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const extracted = normalizePersonMatch(match);
        if (!extracted) continue;
        people.push({
          name: extracted.name,
          role: extracted.role,
          sourceUrl: result.url,
          evidence: excerptAround(text, extracted.name)
        });
      }
    }
  }

  return unique(people, (person) => `${person.name}:${person.role}:${person.sourceUrl}`).slice(0, 8);
}

function normalizePersonMatch(match: RegExpMatchArray): { name: string; role: string } | null {
  const values = match.slice(1).filter(Boolean);
  if (!values.length) return null;
  const role = values.find((value) => /owner|founder|chef|manager|operator|partner/i.test(value));
  const name = values.find((value) => value !== role && /^[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)+$/.test(value));
  if (!name) return null;
  const blocked = ["New York", "Los Angeles", "San Francisco", "Austin Texas", "Contact Us", "Order Online", "Privacy Policy", "Our Mission"];
  if (blocked.some((item) => item.toLowerCase() === name.toLowerCase())) return null;
  if (/\b(Restaurant|Group|LLC|Inc|Menu|Order|Online|Facebook|Instagram|LinkedIn)\b/i.test(name)) return null;
  return {
    name,
    role: role?.toLowerCase() ?? "owner/founder/chef/manager mention"
  };
}

function excerptAround(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text.slice(0, 220);
  return text.slice(Math.max(0, index - 90), Math.min(text.length, index + needle.length + 130)).trim();
}
