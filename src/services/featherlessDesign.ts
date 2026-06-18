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
  const seedPrompts = buildSeedPrompts(lead);
  const fallbackConcept = (): DesignConcept => ({
    restaurantName: lead.name,
    website: lead.website,
    visualDirection: buildVisualDirection(lead),
    featherlessModel: config.featherlessImageModel,
    imagePrompts: seedPrompts,
    menuFooterPrompt: seedPrompts[2] ?? seedPrompts[0],
    generatedAssets: seedPrompts.map((prompt) => ({ kind: "prompt" as const, value: prompt }))
  });
  const featherlessOutput = await callFeatherlessImageModel(lead, seedPrompts, config).catch((error) => {
    console.warn(`[Food Design Director] Featherless design call failed for ${lead.name}; using seed prompts: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  });
  if (!featherlessOutput) return fallbackConcept();
  const parsed = parseJsonObject<FeatherlessPromptResponse>(featherlessOutput);
  if (!parsed) {
    console.warn(`[Food Design Director] Featherless design model returned no JSON for ${lead.name}; using seed prompts.`);
    return fallbackConcept();
  }
  let imagePrompts: string[];
  let menuFooterPrompt: string;
  try {
    imagePrompts = requirePrompts(parsed.imagePrompts);
    menuFooterPrompt = requireText(parsed.menuFooterPrompt, "menuFooterPrompt");
  } catch (error) {
    console.warn(`[Food Design Director] Featherless design JSON was incomplete for ${lead.name}; using seed prompts: ${error instanceof Error ? error.message : String(error)}`);
    return fallbackConcept();
  }
  const generatedAssets = await extractGeneratedAssets(parsed, featherlessOutput, lead);
  if (!generatedAssets.length) {
    generatedAssets.push(...imagePrompts.map((prompt) => ({ kind: "prompt" as const, value: prompt })));
  }

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

function buildVisualDirection(lead: RestaurantLead): string {
  return `Food-first visual refresh for a local ${lead.cuisine} restaurant. Use natural light, richer texture, tighter plating, realistic local-restaurant styling, and assets usable on a website footer, Instagram, and outreach sample.`;
}

async function callFeatherlessImageModel(lead: RestaurantLead, seedPrompts: string[], config: RuntimeConfig): Promise<string> {
  const prompt = `You are the image/design agent in a Band multi-agent workflow.

Use the restaurant research below to create image-generation-ready assets for outreach.
Return only JSON with:
{
  "imagePrompts": ["2-3 production image prompts"],
  "menuFooterPrompt": "one footer/banner prompt",
  "imageUrl": "optional URL if your model returns or can create an image asset",
  "imageBase64": "optional raw base64 PNG/JPEG if your model returns image data",
  "notes": "short implementation note"
}

Important:
- Use the Featherless image/prompt model to enhance food visuals.
- Do not invent exact dish names unless the evidence says them.
- If you cannot return an actual image binary/URL, return strong prompts only.
- No logos, no false claims, no copyrighted brand marks.

Restaurant lead:
${JSON.stringify(lead, null, 2)}

Seed prompts:
${seedPrompts.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;

  return createChatCompletion({
    apiKey: config.featherlessApiKey,
    baseUrl: config.featherlessBaseUrl,
    model: config.featherlessImageModel,
    messages: [
      { role: "system", content: "You are a visual direction model for restaurant food image generation prompts." },
      { role: "user", content: prompt }
    ],
    temperature: config.featherlessTemperature,
    maxTokens: 2200
  });
}

function buildSeedPrompts(lead: RestaurantLead): string[] {
  const sourceHint = lead.imageUrls[0] ? `Current search image reference for visual context: ${lead.imageUrls[0]}.` : "";
  return [
    `Photorealistic hero food image for ${lead.name}, a ${lead.cuisine} restaurant in ${lead.location}. Natural window light, fresh ingredients, appetizing texture, shallow depth of field, website hero crop, no text, no logos. ${sourceHint}`,
    `Square Instagram-ready promo image for ${lead.name}. Show an appetizing ${lead.cuisine} dish on a clean table, warm side light, crisp garnish, high contrast, realistic plating, space for caption overlay but no rendered text.`,
    `Wide menu footer background for ${lead.name}: subtle close-up of ${lead.cuisine} ingredients and plated food, lower contrast center area for contact text, realistic photography, no text.`
  ];
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
  if (parsed?.imageUrl) assets.push({ kind: "image_url", value: parsed.imageUrl });
  if (parsed?.imageBase64) assets.push({ kind: "image_file", value: await saveBase64Image(parsed.imageBase64, lead.name) });

  const dataUrlMatch = rawText.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/);
  if (dataUrlMatch?.[1]) {
    assets.push({ kind: "image_file", value: await saveBase64Image(dataUrlMatch[1], lead.name) });
  }

  const markdownImageUrl = rawText.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
  if (markdownImageUrl?.[1]) assets.push({ kind: "image_url", value: markdownImageUrl[1] });

  if (!parsed && rawText.trim()) assets.push({ kind: "raw_text", value: rawText.trim() });
  return assets;
}

async function saveBase64Image(base64Input: string, restaurantName: string): Promise<string> {
  const cleaned = base64Input.replace(/^data:image\/\w+;base64,/, "");
  const outputDir = "outputs/images";
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, `${slugify(restaurantName)}-${Date.now()}.png`);
  await writeFile(path, Buffer.from(cleaned, "base64"));
  return path;
}
