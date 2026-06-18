import type { RuntimeConfig } from "../shared/config.js";
import type { ImageAudit, SourceEvidence } from "../shared/schemas.js";
import { runFeatherlessVision } from "./featherlessCore.js";
import { parseJsonObject } from "./openAiCompatible.js";

type VisionAuditResponse = {
  boringScore?: number;
  verdict?: "boring" | "average" | "strong" | "unclear";
  reasons?: string[];
  photoIssues?: string[];
  usableVisualHooks?: string[];
  suggestedUpgrade?: string;
};

export async function auditRestaurantImages(input: {
  restaurantName: string;
  website: string;
  cuisine: string;
  location: string;
  imageUrls: string[];
  evidence: SourceEvidence[];
  config: RuntimeConfig;
}): Promise<ImageAudit> {
  const candidateImageUrls = [...new Set(input.imageUrls)].slice(0, 8);
  const auditedImageUrls = await selectUsableImageUrls(candidateImageUrls, 3);
  if (!auditedImageUrls.length) {
    return {
      status: "no_images_found",
      model: input.config.featherlessVisionModel,
      auditedImageUrls: [],
      boringScore: 0,
      verdict: "not_enough_visual_evidence",
      reasons: [
        candidateImageUrls.length
          ? "Exa returned image URL candidates, but none responded as usable image files during preflight."
          : "Exa returned no image URLs, so the system did not visually judge the food photography."
      ],
      photoIssues: [],
      usableVisualHooks: [],
      suggestedUpgrade: "Find public menu/gallery/social images first, then run the Featherless vision audit."
    };
  }

  const textPrompt = `Audit these public restaurant images for outreach qualification.

Restaurant: ${input.restaurantName}
Website: ${input.website}
Cuisine/category: ${input.cuisine}
Location: ${input.location}

Return only JSON:
{
  "boringScore": 0-100,
  "verdict": "boring" | "average" | "strong" | "unclear",
  "reasons": ["visual evidence only"],
  "photoIssues": ["lighting/composition/plating/cropping/color/low-resolution issues if visible"],
  "usableVisualHooks": ["what could be improved in a pitch"],
  "suggestedUpgrade": "one concise visual refresh direction"
}

Rules:
- Judge only the images supplied in this request.
- Do not use website text as proof that a photo is boring.
- If the images are not clearly food/menu photos, use verdict "unclear" and a low-to-mid boringScore.
- boringScore 0 means visually strong, 100 means very weak/boring.
- Be blunt but factual.`;

  const content = [
    { type: "text" as const, text: textPrompt },
    ...auditedImageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } }))
  ];

  const output = await runFeatherlessVision({
    config: input.config,
    system: "You are a strict restaurant food photography auditor. You can only judge images actually provided to you.",
    userContent: content,
    temperature: 0.1,
    maxTokens: 1400
  });
  const parsed = parseJsonObject<VisionAuditResponse>(output);
  if (!parsed) {
    throw new Error(`Featherless vision audit returned no JSON: ${output}`);
  }

  return {
    status: "audited",
    model: input.config.featherlessVisionModel,
    auditedImageUrls,
    boringScore: requireScore(parsed.boringScore),
    verdict: requireVerdict(parsed.verdict),
    reasons: requireStringArray(parsed.reasons, "reasons"),
    photoIssues: requireStringArray(parsed.photoIssues, "photoIssues"),
    usableVisualHooks: requireStringArray(parsed.usableVisualHooks, "usableVisualHooks"),
    suggestedUpgrade: requireString(parsed.suggestedUpgrade, "suggestedUpgrade")
  };
}

async function selectUsableImageUrls(urls: string[], limit: number): Promise<string[]> {
  const usable: string[] = [];
  for (const url of urls) {
    if (usable.length >= limit) break;
    if (await isUsableImageUrl(url)) usable.push(url);
  }
  return usable;
}

async function isUsableImageUrl(url: string): Promise<boolean> {
  return (await checkImageUrl(url, "HEAD")) || (await checkImageUrl(url, "GET"));
}

async function checkImageUrl(url: string, method: "HEAD" | "GET"): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        "User-Agent": "restaurant-pitch-agents/0.1 image-preflight",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {})
      },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    return contentType.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function requireScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Featherless vision audit missing numeric boringScore.");
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requireVerdict(value: unknown): ImageAudit["verdict"] {
  if (value === "boring" || value === "average" || value === "strong" || value === "unclear") return value;
  throw new Error("Featherless vision audit missing valid verdict.");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Featherless vision audit missing ${field}.`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Featherless vision audit missing ${field}.`);
  }
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (!cleaned.length) {
    throw new Error(`Featherless vision audit has empty ${field}.`);
  }
  return cleaned;
}
