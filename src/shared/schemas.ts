import { z } from "zod";

export const sourceEvidenceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  highlights: z.array(z.string()),
  textExcerpt: z.string(),
  imageUrl: z.string().url().optional()
});

export const contactPersonSchema = z.object({
  name: z.string(),
  role: z.string(),
  sourceUrl: z.string().url(),
  evidence: z.string()
});

export const imageAuditSchema = z.object({
  status: z.enum(["audited", "no_images_found"]),
  model: z.string(),
  auditedImageUrls: z.array(z.string().url()),
  boringScore: z.number().int().min(0).max(100),
  verdict: z.enum(["boring", "average", "strong", "unclear", "not_enough_visual_evidence"]),
  reasons: z.array(z.string()),
  photoIssues: z.array(z.string()),
  usableVisualHooks: z.array(z.string()),
  suggestedUpgrade: z.string()
});

export const collaborationActionSchema = z.object({
  at: z.string(),
  agent: z.string(),
  action: z.string(),
  details: z.string()
});

export const candidateLeadSchema = z.object({
  name: z.string(),
  website: z.string().url(),
  domain: z.string(),
  location: z.string(),
  cuisine: z.string(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  contactPeople: z.array(contactPersonSchema),
  menuUrls: z.array(z.string().url()),
  socialUrls: z.array(z.string().url()),
  imageUrls: z.array(z.string().url()),
  sourceUrls: z.array(z.string().url()),
  evidence: z.array(sourceEvidenceSchema)
});

export const restaurantLeadSchema = candidateLeadSchema.extend({
  imageAudit: imageAuditSchema,
  visualOpportunityScore: z.number().int().min(0).max(100),
  visualOpportunityReason: z.string(),
  outreachAngle: z.string()
});

const packetBaseSchema = z.object({
  location: z.string(),
  cuisine: z.string(),
  searchMode: z.enum(["quick", "smart", "deep"]),
  exaSearchType: z.enum(["fast", "auto", "deep", "deep-reasoning"]),
  generatedAt: z.string(),
  exaRequestCount: z.number().int(),
  notes: z.array(z.string()),
  collaborationLog: z.array(collaborationActionSchema)
});

export const candidateResearchPacketSchema = packetBaseSchema.extend({
  type: z.literal("candidate_research_packet"),
  leads: z.array(candidateLeadSchema)
});

export const researchPacketSchema = packetBaseSchema.extend({
  type: z.literal("research_packet"),
  leads: z.array(restaurantLeadSchema),
});

export const outreachCopySchema = z.object({
  restaurantName: z.string(),
  website: z.string().url(),
  emailSubjects: z.array(z.string()),
  coldEmail: z.string(),
  instagramDm: z.string(),
  smsVariant: z.string(),
  personalizationNotes: z.array(z.string())
});

export const copyPackageSchema = z.object({
  type: z.literal("copy_package"),
  agencyName: z.string(),
  location: z.string(),
  cuisine: z.string(),
  generatedAt: z.string(),
  copy: z.array(outreachCopySchema),
  research: researchPacketSchema
});

export const designConceptSchema = z.object({
  restaurantName: z.string(),
  website: z.string().url(),
  visualDirection: z.string(),
  featherlessModel: z.string(),
  imagePrompts: z.array(z.string()),
  menuFooterPrompt: z.string(),
  generatedAssets: z.array(
    z.object({
      kind: z.enum(["prompt", "image_url", "image_file", "raw_text"]),
      value: z.string()
    })
  )
});

export const designPackageSchema = z.object({
  type: z.literal("design_package"),
  agencyName: z.string(),
  generatedAt: z.string(),
  concepts: z.array(designConceptSchema),
  copyPackage: copyPackageSchema
});

export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type ContactPerson = z.infer<typeof contactPersonSchema>;
export type ImageAudit = z.infer<typeof imageAuditSchema>;
export type CollaborationAction = z.infer<typeof collaborationActionSchema>;
export type CandidateLead = z.infer<typeof candidateLeadSchema>;
export type CandidateResearchPacket = z.infer<typeof candidateResearchPacketSchema>;
export type RestaurantLead = z.infer<typeof restaurantLeadSchema>;
export type ResearchPacket = z.infer<typeof researchPacketSchema>;
export type OutreachCopy = z.infer<typeof outreachCopySchema>;
export type CopyPackage = z.infer<typeof copyPackageSchema>;
export type DesignConcept = z.infer<typeof designConceptSchema>;
export type DesignPackage = z.infer<typeof designPackageSchema>;

export function hasJsonPayloadType(text: string, type: string): boolean {
  return new RegExp(`"type"\\s*:\\s*"${escapeRegExp(type)}"`).test(text);
}

export function parseJsonPayload<T>(text: string, schema: z.ZodType<T>): T {
  const parsedPayloads = extractJsonObjects(text)
    .map((candidate) => safeJsonParse(candidate))
    .filter((candidate): candidate is unknown => candidate !== null);
  for (const payload of parsedPayloads.reverse()) {
    const result = schema.safeParse(payload);
    if (result.success) return result.data;
  }
  throw new Error("Message did not contain a JSON object payload matching the expected schema.");
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    const end = findJsonObjectEnd(text, start);
    if (end !== -1) {
      objects.push(text.slice(start, end + 1));
    }
  }
  return objects;
}

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
