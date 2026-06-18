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
  const prompt = `Write concise outreach copy for this restaurant lead. Return only JSON with keys emailSubjects, coldEmail, instagramDm, smsVariant, personalizationNotes.

Restaurant lead:
${JSON.stringify(lead, null, 2)}

Agency: ${config.agencyName}
Rules:
- Be specific to the evidence.
- Do not invent metrics, relationships, or menu items not present in the lead.
- Pitch a visual refresh: food photos, menu footer asset, and social-ready images.
- Cold email should be under 150 words.
- Instagram DM should be under 450 characters.`;

  const content = await runFeatherlessChat({
    config,
    system: "You are a direct-response copywriting agent in a Band multi-agent workflow. Your core model provider is Featherless. Return valid JSON only.",
    user: prompt,
    temperature: 0.5,
    maxTokens: 1400
  });
  const parsed = parseJsonObject<LlmCopyResponse>(content);
  if (!parsed) {
    console.warn(`[Pitch Copywriter] Featherless returned no copy JSON for ${lead.name}; using evidence-bound fallback copy.`);
    return composeFallbackOutreachCopy(lead, config);
  }
  try {
    return {
      restaurantName: lead.name,
      website: lead.website,
      emailSubjects: requireStringArray(parsed.emailSubjects, "emailSubjects"),
      coldEmail: requireString(parsed.coldEmail, "coldEmail"),
      instagramDm: requireString(parsed.instagramDm, "instagramDm"),
      smsVariant: requireString(parsed.smsVariant, "smsVariant"),
      personalizationNotes: requireStringArray(parsed.personalizationNotes, "personalizationNotes")
    };
  } catch (error) {
    console.warn(`[Pitch Copywriter] Featherless copy JSON was incomplete for ${lead.name}; using evidence-bound fallback copy: ${error instanceof Error ? error.message : String(error)}`);
    return composeFallbackOutreachCopy(lead, config);
  }
}

function composeFallbackOutreachCopy(lead: RestaurantLead, config: RuntimeConfig): OutreachCopy {
  const contactName = lead.contactPeople[0]?.name.split(/\s+/)[0] ?? "team";
  const visualReason = lead.visualOpportunityReason || lead.outreachAngle;
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
      `Visual refresh idea for ${lead.name}`,
      `${lead.name}: food photos + menu assets`,
      `Quick menu visual upgrade`
    ],
    coldEmail: `Hi ${contactName},\n\nI found ${lead.name} while reviewing ${lead.cuisine} restaurants in ${lead.location}. Your public site/menu gives enough context for a small visual refresh: ${visualReason}.\n\n${config.agencyName} can put together a compact outreach-ready asset set: refreshed food-photo direction, a menu footer/banner prompt, and social-ready image concepts based on the visuals already public.\n\nWould it be useful if I sent two sample concepts for ${lead.name}?`,
    instagramDm: `Hi ${contactName}, I was looking at ${lead.name} and saw a clear opportunity for sharper food/menu visuals. I can send 2 sample concepts: food-photo direction, a menu footer/banner, and social-ready assets. Worth a look?`,
    smsVariant: `Hi ${contactName}, quick idea for ${lead.name}: 2 sample food/menu visual refresh concepts for web + social. Want me to send them over?`,
    personalizationNotes: [
      `Website reviewed: ${lead.website}`,
      `Visual audit: ${lead.imageAudit.verdict}, boring score ${lead.imageAudit.boringScore}/100.`,
      `Opportunity reason: ${visualReason}`,
      contactNote
    ]
  };
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
