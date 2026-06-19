import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig, type RuntimeConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import type { CopyPackage, DesignConcept, DesignPackage, RestaurantLead } from "../shared/schemas.js";
import { nowIso, slugify } from "../shared/utils.js";
import { createChatCompletion, parseJsonObject } from "./openAiCompatible.js";

type FeatherlessPromptResponse = {
  imagePrompts?: string[];
  menuFooterPrompt?: string;
  imageUrl?: string;
  imageBase64?: string;
  notes?: string;
};

type GeneratedAsset = DesignConcept["generatedAssets"][number];

export async function createDesignPackage(copyPackage: CopyPackage, config = loadConfig({ requireFeatherless: true })): Promise<DesignPackage> {
  const concepts: DesignConcept[] = [];
  for (const lead of copyPackage.research.leads) {
    concepts.push(await createDesignConcept(lead, config));
  }
  const copyPackageWithLog: CopyPackage = {
    ...copyPackage,
    research: {
      ...copyPackage.research,
      collaborationLog: [
        ...copyPackage.research.collaborationLog,
        action("Food Design Director", "featherless_visual_concepts", `Created Featherless visual prompts/assets for ${concepts.length} leads.`)
      ]
    }
  };
  return {
    type: "design_package",
    agencyName: config.agencyName,
    generatedAt: nowIso(),
    concepts,
    copyPackage: copyPackageWithLog
  };
}

async function createDesignConcept(lead: RestaurantLead, config: RuntimeConfig): Promise<DesignConcept> {
  const fallbackPrompts = buildFallbackPrompts(lead);
  const featherlessOutput = await callFeatherlessImageModel(lead, fallbackPrompts, config).catch((error) => {
    console.warn(`[Food Design Director] Featherless design call failed for ${lead.name}; continuing with deterministic prompts and OpenAI image generation: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  });
  if (!featherlessOutput) return createConceptWithOpenAiFallback(lead, fallbackPrompts, fallbackPrompts[2] ?? fallbackPrompts[0], [], config);
  const parsed = parseJsonObject<FeatherlessPromptResponse>(featherlessOutput);
  if (!parsed) {
    console.warn(`[Food Design Director] Featherless design model returned empty JSON for ${lead.name}; continuing with deterministic prompts and OpenAI image generation.`);
    return createConceptWithOpenAiFallback(lead, fallbackPrompts, fallbackPrompts[2] ?? fallbackPrompts[0], [], config);
  }
  let imagePrompts: string[];
  let menuFooterPrompt: string;
  try {
    imagePrompts = requirePrompts(parsed.imagePrompts);
    menuFooterPrompt = requireText(parsed.menuFooterPrompt, "menuFooterPrompt");
  } catch (error) {
    console.warn(`[Food Design Director] Featherless design JSON was incomplete for ${lead.name}; continuing with deterministic prompts and OpenAI image generation: ${error instanceof Error ? error.message : String(error)}`);
    return createConceptWithOpenAiFallback(lead, fallbackPrompts, fallbackPrompts[2] ?? fallbackPrompts[0], [], config);
  }
  const generatedAssets = await extractGeneratedAssets(parsed, featherlessOutput, lead);
  if (!hasRenderedImage(generatedAssets)) {
    const openAiAsset = await generateOpenAiImageAsset(buildOpenAiImagePrompt(lead, imagePrompts[0] ?? fallbackPrompts[0]), lead.name, config);
    generatedAssets.push(openAiAsset);
  }
  generatedAssets.push(...imagePrompts.map((prompt) => ({ kind: "prompt" as const, value: prompt })));

  return {
    restaurantName: lead.name,
    website: lead.website,
    visualDirection: buildVisualDirection(lead),
    featherlessModel: config.featherlessImageModel,
    imagePrompts,
    menuFooterPrompt,
    generatedAssets
  };
}

async function createConceptWithOpenAiFallback(
  lead: RestaurantLead,
  imagePrompts: string[],
  menuFooterPrompt: string,
  assets: GeneratedAsset[],
  config: RuntimeConfig
): Promise<DesignConcept> {
  const generatedAssets = [...assets];
  if (!hasRenderedImage(generatedAssets)) {
    generatedAssets.push(await generateOpenAiImageAsset(buildOpenAiImagePrompt(lead, imagePrompts[0]), lead.name, config));
  }
  generatedAssets.push(...imagePrompts.map((prompt) => ({ kind: "prompt" as const, value: prompt })));
  return {
    restaurantName: lead.name,
    website: lead.website,
    visualDirection: buildVisualDirection(lead),
    featherlessModel: `${config.featherlessImageModel} + OpenAI ${config.openAiImageModel}`,
    imagePrompts,
    menuFooterPrompt,
    generatedAssets
  };
}

function hasRenderedImage(assets: GeneratedAsset[]): boolean {
  return assets.some((asset) => asset.kind === "image_file" || asset.kind === "image_url");
}

function buildOpenAiImagePrompt(lead: RestaurantLead, basePrompt: string): string {
  return [
    basePrompt,
    "",
    `Create a finished, premium restaurant marketing image for ${lead.name}.`,
    "Act like a senior food photographer shooting a real web/menu hero asset: appetite first, clear focal dish, controlled props, believable restaurant table setting.",
    "Use directional natural light, crisp texture, shallow depth of field, warm highlights, clean negative space for real HTML text, and a crop that works on mobile.",
    "Use a text-free, logo-free, watermark-free, sign-free scene with real-looking plated food, natural plate geometry, and restaurant-grade styling.",
    `Cuisine/category: ${lead.cuisine}. Location context: ${lead.location}. Visual issue to solve: ${buildDesignIssue(lead)}.`
  ].join("\n");
}

async function generateOpenAiImageAsset(prompt: string, restaurantName: string, config: RuntimeConfig): Promise<GeneratedAsset> {
  if (!config.openAiApiKey) {
    throw new Error("OpenAI image generation needs OPENAI_API_KEY because Featherless returned prompts without rendered image data.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openAiImageModel,
        prompt,
        size: config.openAiImageSize,
        quality: config.openAiImageQuality,
        n: 1
      }),
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI image generation failed (${response.status}): ${bodyText}`);
    }
    const data = JSON.parse(bodyText) as { data?: Array<{ b64_json?: string; url?: string }> };
    const image = data.data?.[0];
    if (image?.b64_json) {
      return { kind: "image_file", value: await saveBase64Image(image.b64_json, restaurantName) };
    }
    if (image?.url) {
      return { kind: "image_url", value: image.url };
    }
    throw new Error(`OpenAI image generation returned empty image data: ${bodyText}`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildVisualDirection(lead: RestaurantLead): string {
  return `Restaurant merchandising direction: solve this issue: ${buildDesignIssue(lead)}. Create one food-first hero/menu image and one social crop with natural side light, tighter composition, visible texture, restrained props, and mobile-safe negative space.`;
}

async function callFeatherlessImageModel(lead: RestaurantLead, fallbackPrompts: string[], config: RuntimeConfig): Promise<string> {
  const prompt = `You are the senior food photography art director for this restaurant lead.

Use the restaurant research below to create image-generation-ready assets for outreach.
Return strict JSON with:
{
  "imagePrompts": ["2-3 production image prompts"],
  "menuFooterPrompt": "one footer/banner prompt",
  "imageUrl": "optional URL if your model returns or can create an image asset",
  "imageBase64": "optional raw base64 PNG/JPEG if your model returns image data",
  "notes": "short implementation note"
}

Expertise activation:
- Think like a restaurant menu merchandiser, food stylist, and conversion-focused web designer.
- Tie every prompt to the exact weakness from the image audit.
- Design for the assets a small restaurant owner can actually use tomorrow: website hero/menu banner, Instagram square, and menu/footer background.
- Specify lighting, angle, crop, focal hierarchy, surface/plate context, texture cues, and negative space.

Hard rules:
- Use dish names from evidence; otherwise describe cuisine/category.
- Keep scenes text-free, logo-free, watermark-free, claim-free, brand-mark-free, and free of menu boards or signage.
- Keep model names and internal audit scores out of the prompts.
- When an actual image binary/URL is unavailable, return strong prompts.
- Keep each prompt under 95 words.

Restaurant lead:
${JSON.stringify(lead, null, 2)}

Fallback prompts:
${fallbackPrompts.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;

  return createChatCompletion({
    apiKey: config.featherlessApiKey,
    baseUrl: config.featherlessBaseUrl,
    model: config.featherlessImageModel,
    messages: [
      { role: "system", content: "You are a senior food photography art director and restaurant web conversion designer. Return a valid JSON object; omit analysis prose." },
      { role: "user", content: prompt }
    ],
    temperature: config.featherlessTemperature,
    maxTokens: 2200
  });
}

function buildFallbackPrompts(lead: RestaurantLead): string[] {
  const sourceHint = lead.imageUrls[0] ? `Current search image reference for visual context: ${lead.imageUrls[0]}.` : "";
  const designIssue = buildDesignIssue(lead);
  return [
    `Website hero/menu image for ${lead.name}, a ${lead.cuisine} restaurant in ${lead.location}. Solve this visual issue: ${designIssue}. Shoot a real plated dish in a 3/4 angle, natural side light, crisp texture, warm highlights, shallow depth of field, mobile-safe negative space, believable restaurant table setting, text-free and logo-free. ${sourceHint}`,
    `Square Instagram crop for ${lead.name}. Close, appetite-led composition with one clear focal dish, visible texture, restrained garnish, clean plate edge, soft background, warm side light, text-free, signage-free, logo-free. Designed to make the menu item easy to choose in a social feed.`,
    `Wide 3:1 menu/footer background for ${lead.name}. Low-contrast close-up of plated ${lead.cuisine} food and ingredients along the edges, calm center/right negative space for real HTML contact text, realistic restaurant lighting, text-free, logo-free, menu-board-free.`
  ];
}

function buildDesignIssue(lead: RestaurantLead): string {
  const issue = lead.imageAudit.photoIssues[0] ?? lead.imageAudit.suggestedUpgrade ?? lead.visualOpportunityReason;
  const cleaned = issue
    .replace(/Featherless vision audit:?\s*/gi, "")
    .replace(/\([^)]*boring score[^)]*\)/gi, "")
    .replace(/\bboring\b/gi, "flat")
    .replace(/\baverage\b/gi, "serviceable")
    .replace(/\s+/g, " ")
    .trim();
  if (/no food( photography)?|no food or menu items shown/i.test(cleaned)) {
    return "the current page delays the food image";
  }
  return cleaned || "the current food/menu visuals need a stronger first impression";
}

function requirePrompts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Featherless image/design response missing imagePrompts.");
  }
  const prompts = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (!prompts.length) {
    throw new Error("Featherless image/design response has empty imagePrompts.");
  }
  return prompts;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Featherless image/design response missing ${field}.`);
  }
  return value.trim();
}

async function extractGeneratedAssets(parsed: FeatherlessPromptResponse | null, rawText: string, lead: RestaurantLead): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = [];
  if (parsed?.imageUrl && !isSourceImageUrl(parsed.imageUrl, lead)) assets.push({ kind: "image_url", value: parsed.imageUrl });
  if (parsed?.imageBase64) assets.push({ kind: "image_file", value: await saveBase64Image(parsed.imageBase64, lead.name) });

  const dataUrlMatch = rawText.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/);
  if (dataUrlMatch?.[1]) {
    assets.push({ kind: "image_file", value: await saveBase64Image(dataUrlMatch[1], lead.name) });
  }

  const markdownImageUrl = rawText.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
  if (markdownImageUrl?.[1] && !isSourceImageUrl(markdownImageUrl[1], lead)) assets.push({ kind: "image_url", value: markdownImageUrl[1] });

  if (!parsed && rawText.trim()) assets.push({ kind: "raw_text", value: rawText.trim() });
  return assets;
}

function isSourceImageUrl(url: string, lead: RestaurantLead): boolean {
  return lead.imageUrls.some((sourceUrl) => sourceUrl === url) || lead.sourceUrls.some((sourceUrl) => sourceUrl === url);
}

async function saveBase64Image(base64Input: string, restaurantName: string): Promise<string> {
  const cleaned = base64Input.replace(/^data:image\/\w+;base64,/, "");
  const outputDir = "outputs/images";
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, `${slugify(restaurantName)}-${Date.now()}.png`);
  await writeFile(path, Buffer.from(cleaned, "base64"));
  return path;
}
