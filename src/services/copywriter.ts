import { loadConfig, type RuntimeConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import type { CopyPackage, OutreachCopy, ResearchPacket, RestaurantLead } from "../shared/schemas.js";
import { nowIso } from "../shared/utils.js";
import { runFeatherlessChat } from "./featherlessCore.js";
import { parseJsonObject } from "./openAiCompatible.js";

type LlmCopyResponse = {
  emailSubjects?: string[];
  coldEmail?: string;
  instagramDm?: string;
  smsVariant?: string;
  personalizationNotes?: string[];
};

const bannedCopyPhrases = [
  "worth a look",
  "visual refresh",
  "boring score",
  "featherless",
  "public site/menu gives enough context",
  "clear opportunity",
  "outreach-ready asset set",
  "boost your",
  "enhance your online presence",
  "looking forward",
  "[your name]",
  "best,",
  "visual boost",
  "eye-catching",
  "boost engagement",
  "engagement",
  "opportunity",
  "i've created",
  "i’ve created",
  "i've designed",
  "i’ve designed",
  "need adjustments",
  "refine them",
  "attract more customers",
  "fresh visuals",
  "deserve visuals",
  "vibrant offerings",
  "brand's energy"
];

export async function composeCopyPackage(research: ResearchPacket, config = loadConfig()): Promise<CopyPackage> {
  const copy: OutreachCopy[] = [];
  for (const lead of research.leads) {
    copy.push(await composeOutreachCopy(lead, config));
  }
  const researchWithLog: ResearchPacket = {
    ...research,
    collaborationLog: [
      ...research.collaborationLog,
      action("Pitch Copywriter", "featherless_copywriting", `Wrote email, DM, SMS, and subject line copy for ${copy.length} visually audited leads.`),
      action("Pitch Copywriter", "delegate_design", `Forwarded ${copy.length} copy packs to Food Design Director.`)
    ]
  };
  return {
    type: "copy_package",
    agencyName: config.agencyName,
    location: research.location,
    cuisine: research.cuisine,
    generatedAt: nowIso(),
    copy,
    research: researchWithLog
  };
}

async function composeOutreachCopy(lead: RestaurantLead, config: RuntimeConfig): Promise<OutreachCopy> {
  const prompt = buildExpertCopyPrompt(lead, config);

  const content = await runFeatherlessChat({
    config,
    system: [
      "You are a senior restaurant growth copywriter and food-creative director.",
      "You write owner-to-owner outreach for independent restaurants.",
      "You diagnose one visible menu/photo merchandising problem, connect it to online ordering or inquiry friction, and offer a small concrete fix.",
      "Return a valid JSON object; omit markdown, reasoning, and preface."
    ].join(" "),
    user: prompt,
    temperature: 0.35,
    maxTokens: 1400
  });
  const parsed = parseJsonObject<LlmCopyResponse>(content);
  if (!parsed) {
    console.warn(`[Pitch Copywriter] Featherless returned empty copy JSON for ${lead.name}; using evidence-bound copy.`);
    return composeFallbackOutreachCopy(lead, config);
  }
  try {
    const copy = {
      restaurantName: lead.name,
      website: lead.website,
      emailSubjects: requireStringArray(parsed.emailSubjects, "emailSubjects"),
      coldEmail: requireString(parsed.coldEmail, "coldEmail"),
      instagramDm: requireString(parsed.instagramDm, "instagramDm"),
      smsVariant: requireString(parsed.smsVariant, "smsVariant"),
      personalizationNotes: optionalStringArray(parsed.personalizationNotes) ?? buildPersonalizationNotes(lead)
    };
    assertExpertCopy(copy);
    return copy;
  } catch (error) {
    console.warn(`[Pitch Copywriter] Featherless copy JSON was incomplete for ${lead.name}; using evidence-bound fallback copy: ${error instanceof Error ? error.message : String(error)}`);
    return composeFallbackOutreachCopy(lead, config);
  }
}

function buildExpertCopyPrompt(lead: RestaurantLead, config: RuntimeConfig): string {
  return `Write concise outreach copy for this restaurant lead.
Return strict JSON with keys emailSubjects, coldEmail, instagramDm, smsVariant, personalizationNotes.

Expertise activation:
- Think like a restaurant revenue operator, menu merchandiser, and food photography art director.
- Diagnose the specific visible friction from the audit: weak hero image, flat/underlit food, distracting background, menu doing too much work, missing social-ready crop, or poor mobile first impression.
- Convert the diagnosis into a small offer: 2 concrete mockups, one stronger hero/menu image and one social/menu crop.
- The owner should feel "this person looked at my restaurant and knows the exact next asset I need."

Restaurant lead JSON:
${JSON.stringify(lead, null, 2)}

Agency: ${config.agencyName}

Hard rules:
- Keep model names, AI providers, audit scores, "boring score", and internal research out of customer copy.
- Exclude these phrases: ${bannedCopyPhrases.join(", ")}.
- Use facts present in the lead; leave out invented metrics, relationships, dish names, awards, and menu items.
- Keep the tone respectful; describe the image issue and the practical fix.
- Lead with one observed issue and one practical fix.
- Cold email: under 120 words, 3 short paragraphs max, plain English.
- Instagram DM: under 300 characters.
- SMS: under 220 characters.
- Subject lines: under 45 characters each.
- Use plain language: zero hype, zero exclamation marks, zero filler.`;
}

function composeFallbackOutreachCopy(lead: RestaurantLead, config: RuntimeConfig): OutreachCopy {
  const contactName = ownerSafeFirstName(lead.contactPeople[0]?.name);
  const issue = buildOwnerSafeIssue(lead);
  const subjectName = subjectSafeName(lead.name);
  const contactNote = lead.emails.length
    ? `Direct email found: ${lead.emails[0]}.`
    : lead.socialUrls.length
      ? `Use social outreach: ${lead.socialUrls[0]}.`
      : lead.phones.length
        ? `Phone outreach available: ${lead.phones[0]}.`
        : "Use website/contact-form outreach.";

  return {
    restaurantName: lead.name,
    website: lead.website,
    emailSubjects: [
      `Photo note for ${subjectName}`,
      `${subjectName} menu photos`,
      `2 image ideas`
    ],
    coldEmail: `Hi ${contactName},\n\nI was looking at ${lead.name}'s site and noticed ${issue}. That can make the menu do all the selling before the food has a chance to pull someone in.\n\n${config.agencyName} makes compact restaurant image kits: one stronger hero/menu image, one social crop, and the short caption copy to match.\n\nCan I send two mockups for ${lead.name}?`,
    instagramDm: `Hi ${contactName}, quick note on ${lead.name}: ${issue}. I can send 2 tighter mockups: a hero/menu image and a social crop. Send them here?`,
    smsVariant: `Hi ${contactName}, quick ${lead.name} idea: 2 tighter food/menu image mockups for web + social. Can I send them?`,
    personalizationNotes: [...buildPersonalizationNotes(lead), contactNote]
  };
}

function subjectSafeName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  return cleaned.length <= 24 ? cleaned : `${cleaned.slice(0, 21).trim()}...`;
}

function buildPersonalizationNotes(lead: RestaurantLead): string[] {
  return [
    `Website reviewed: ${lead.website}`,
    `Observed issue: ${buildOwnerSafeIssue(lead)}`,
    `Offer: 2 mockups, one hero/menu image and one social crop.`
  ];
}

function buildOwnerSafeIssue(lead: RestaurantLead): string {
  const issue = lead.imageAudit.photoIssues[0] ?? lead.imageAudit.suggestedUpgrade ?? lead.visualOpportunityReason;
  const cleaned = stripInternalTerms(issue)
    .replace(/^the\s+/i, "")
    .replace(/\.$/, "")
    .trim();
  if (/overhead shot lacks dynamic angle/i.test(cleaned)) {
    return "the current food/menu visuals lean on an overhead shot, so the dish loses depth and texture";
  }
  if (/underlit|flat/i.test(cleaned)) {
    return "the current food/menu visuals look a little underlit and flat";
  }
  if (/background.*distract/i.test(cleaned)) {
    return "the current food/menu visuals have background distractions pulling attention from the food";
  }
  if (/low-resolution|pixelation/i.test(cleaned)) {
    return "some current food/menu visuals look low-resolution in places";
  }
  if (/no food( photography)?|no food or menu items shown/i.test(cleaned)) {
    return "the current page delays the food image";
  }
  if (cleaned) return `the current food/menu visuals could be stronger: ${cleaned}`;
  return "the current food/menu visuals could use a stronger first impression";
}

function ownerSafeFirstName(name: string | undefined): string {
  if (!name) return "team";
  const first = name.split(/\s+/)[0]?.trim();
  if (!first || /^(owner|founder|chef|manager|team)$/i.test(first)) return "team";
  return first;
}

function stripInternalTerms(value: string): string {
  return value
    .replace(/Featherless vision audit:?\s*/gi, "")
    .replace(/\([^)]*boring score[^)]*\)/gi, "")
    .replace(/\bboring score\b/gi, "visual score")
    .replace(/\bboring\b/gi, "flat")
    .replace(/\baverage\b/gi, "serviceable")
    .replace(/\s+/g, " ")
    .trim();
}

function assertExpertCopy(copy: OutreachCopy): void {
  const joined = [
    ...copy.emailSubjects,
    copy.coldEmail,
    copy.instagramDm,
    copy.smsVariant,
    ...copy.personalizationNotes
  ].join("\n").toLowerCase();
  const banned = bannedCopyPhrases.find((phrase) => joined.includes(phrase));
  if (banned) throw new Error(`copy used banned weak/internal phrase "${banned}"`);
  if (copy.emailSubjects.length < 3) {
    throw new Error("copy is missing three subject lines.");
  }
  if (/\b(enhance|boost|elevate|transform|captivate)\b/i.test(copy.emailSubjects.join(" "))) {
    throw new Error("subject lines used weak agency verbs.");
  }
  if (/\[(your name|name|agency)\]/i.test(joined)) {
    throw new Error("copy included unresolved placeholder text.");
  }
  if (!/^hi\s+/i.test(copy.coldEmail.trim())) {
    throw new Error("coldEmail must start with a direct owner greeting.");
  }
  if (!/\b(can i send|should i send|want me to send|send them here)\b/i.test(`${copy.coldEmail}\n${copy.instagramDm}\n${copy.smsVariant}`)) {
    throw new Error("copy is missing a simple send-the-mockups CTA.");
  }
  if (copy.coldEmail.split(/\s+/).filter(Boolean).length > 140) {
    throw new Error("coldEmail was too long for expert outreach.");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Featherless copywriter response missing ${field}.`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Featherless copywriter response missing ${field}.`);
  }
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (!cleaned.length) {
    throw new Error(`Featherless copywriter response has empty ${field}.`);
  }
  return cleaned;
}

function optionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return cleaned.length ? cleaned : null;
}
