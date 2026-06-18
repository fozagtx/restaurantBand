import { loadConfig } from "../shared/config.js";
import { DAILY_VALIDATED_LEAD_TARGET, capLeadLimit } from "../shared/leadPolicy.js";
import { runFeatherlessChat } from "../services/featherlessCore.js";

export type ResearchTask = {
  location: string;
  cuisine: string;
  limit: number;
  searchMode: "quick" | "smart" | "deep";
  exaSearchType: "fast" | "auto" | "deep" | "deep-reasoning";
};

export async function parseResearchTask(message: string, config = loadConfig({ requireFeatherless: true })): Promise<ResearchTask> {
  const normalizedMessage = message.replace(/@\[\[[^\]]+]]/g, "").trim();
  const prompt = `Extract the restaurant lead-search task from this user or agent message.
Return only JSON with:
{
  "location": "city/area",
  "cuisine": "restaurant category or cuisine",
  "limit": 1-2,
  "searchMode": "quick" | "smart" | "deep",
  "exaSearchType": "fast" | "auto" | "deep" | "deep-reasoning"
}

Message:
${normalizedMessage}

Required:
- location must be explicitly present in the message.
- cuisine/category must be explicitly present in the message.
- if count is missing, use limit ${DAILY_VALIDATED_LEAD_TARGET}.
- if the requested count is above ${DAILY_VALIDATED_LEAD_TARGET}, cap limit at ${DAILY_VALIDATED_LEAD_TARGET}.
- if search depth is missing, use smart.
- Infer searchMode from the user's intent:
  - quick = fast lead scan, low latency, first-pass prospect list.
  - smart = balanced quality/speed research when the user explicitly asks for smart/balanced search.
  - deep = thorough research, harder lead qualification, or the user says deep.
- Map searchMode to Exa type:
  - quick -> fast
  - smart -> auto
  - deep -> deep
  - if the user explicitly says "deep reasoning", "very deep", or "highest reasoning", use exaSearchType deep-reasoning while searchMode remains deep.
- If location or cuisine/category is missing, return JSON with an "error" key instead of guessing.
- Do not include <think>, explanation, markdown, or prose.
- Your entire response must be one JSON object.`;

  const output = await runFeatherlessChat({
    config,
    system: `You are the Featherless-powered task parser for a Band research agent. Extract explicit location and cuisine/category. Default missing count to ${DAILY_VALIDATED_LEAD_TARGET} and missing search depth to smart. Return only one compact JSON object and no reasoning text.`,
    user: prompt,
    temperature: 0.1,
    maxTokens: 900
  });
  const fallbackParsed = parseExplicitTaskFromText(normalizedMessage);
  const parsed = parseTaskJson(output) ?? fallbackParsed;
  if (!parsed) {
    throw new Error(`Featherless task parser returned no usable JSON and the message did not contain explicit location/cuisine fields: ${output}`);
  }
  if (parsed.error) {
    if (!fallbackParsed) throw new Error(`Task is missing required search details: ${parsed.error}`);
    Object.assign(parsed, fallbackParsed);
  }
  if (typeof parsed.location !== "string" || !parsed.location.trim()) {
    throw new Error("Task is missing an explicit location.");
  }
  if (typeof parsed.cuisine !== "string" || !parsed.cuisine.trim()) {
    throw new Error("Task is missing an explicit cuisine or restaurant category.");
  }
  const limit = typeof parsed.limit === "number" && Number.isFinite(parsed.limit) ? parsed.limit : DAILY_VALIDATED_LEAD_TARGET;
  const searchMode = isSearchMode(parsed.searchMode) ? parsed.searchMode : "smart";
  const exaSearchType = normalizeExaSearchType(searchMode, parsed.exaSearchType, normalizedMessage);
  return {
    location: parsed.location.trim(),
    cuisine: normalizeCuisine(parsed.cuisine),
    limit: capLeadLimit(limit),
    searchMode,
    exaSearchType
  };
}

function parseTaskJson(output: string): (Partial<ResearchTask> & { error?: string }) | null {
  const withoutThinking = output.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return JSON.parse(withoutThinking.slice(start, end + 1)) as Partial<ResearchTask> & { error?: string };
}

function parseExplicitTaskFromText(message: string): (Partial<ResearchTask> & { error?: string }) | null {
  const limitMatch = message.match(/\b(?:find|limit|top)\s+(\d{1,2})\b/i) ?? message.match(/\b(\d{1,2})\s+(?:restaurant|restaurants|lead|leads)\b/i);
  const locationMatch = message.match(/\bin\s+([A-Za-z .'-]+,\s*[A-Z]{2})\b/i) ?? message.match(/\bin\s+([A-Za-z .'-]+\s+[A-Z]{2})\b/i);
  const cuisineMatch =
    message.match(/\b(?:find|search: find|search for|look for)\s+(?:\d{1,2}\s+)?(.+?)\s+(?:restaurant|restaurants|shop|shops|cafe|cafes|lead|leads|place|places)\b/i) ??
    message.match(/\b(sushie|sushi|pizza|taco|thai|mexican|burger|coffee|bakery|bbq|barbecue)\b/i);
  if (!locationMatch?.[1] || !cuisineMatch?.[1]) return null;
  const lower = message.toLowerCase();
  const searchMode: ResearchTask["searchMode"] = lower.includes("quick")
    ? "quick"
    : lower.includes("deep")
      ? "deep"
      : lower.includes("smart") || lower.includes("balanced")
        ? "smart"
        : "smart";
  return {
    location: normalizeLocation(locationMatch[1]),
    cuisine: normalizeCuisine(cuisineMatch[1]),
    limit: limitMatch?.[1] ? Number.parseInt(limitMatch[1], 10) : DAILY_VALIDATED_LEAD_TARGET,
    searchMode,
    exaSearchType: normalizeExaSearchType(searchMode, undefined, message)
  };
}

function isSearchMode(value: unknown): value is ResearchTask["searchMode"] {
  return value === "quick" || value === "smart" || value === "deep";
}

function normalizeCuisine(value: string): string {
  return value.trim().replace(/\bsushie\b/gi, "sushi").replace(/\s+/g, " ");
}

function normalizeLocation(value: string): string {
  return value.trim().replace(/\s+([A-Z]{2})$/i, ", $1").replace(/\s+/g, " ");
}

function normalizeExaSearchType(
  searchMode: ResearchTask["searchMode"],
  modelValue: unknown,
  originalMessage: string
): ResearchTask["exaSearchType"] {
  if (modelValue === "fast" || modelValue === "auto" || modelValue === "deep" || modelValue === "deep-reasoning") {
    return modelValue;
  }
  const lower = originalMessage.toLowerCase();
  if (searchMode === "quick") return "fast";
  if (searchMode === "deep" && /\b(deep reasoning|very deep|highest reasoning)\b/.test(lower)) return "deep-reasoning";
  if (searchMode === "deep") return "deep";
  return "auto";
}
