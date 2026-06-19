import "dotenv/config";

export type RuntimeConfig = {
  bandRestUrl: string;
  bandWsUrl: string;
  exaApiKey: string;
  exaNumResults: number;
  featherlessApiKey: string;
  featherlessBaseUrl: string;
  featherlessChatModel: string;
  featherlessVisionModel: string;
  featherlessImageModel: string;
  featherlessTemperature: number;
  openAiApiKey: string;
  openAiImageModel: string;
  openAiImageSize: string;
  openAiImageQuality: string;
  telegramBotToken: string;
  telegramChatId: string;
  researchAgentMention: string;
  visualInspectorAgentMention: string;
  copywriterAgentMention: string;
  designAgentMention: string;
  agencyName: string;
};

export function loadConfig(options: { requireExa?: boolean; requireFeatherless?: boolean; requireTelegram?: boolean } = {}): RuntimeConfig {
  const config: RuntimeConfig = {
    bandRestUrl: env("BAND_REST_URL", "https://app.band.ai/"),
    bandWsUrl: env("BAND_WS_URL", "wss://app.band.ai/api/v1/socket/websocket"),
    exaApiKey: env("EXA_API_KEY"),
    exaNumResults: envInt("EXA_NUM_RESULTS", 12),
    featherlessApiKey: env("FEATHERLESS_API_KEY"),
    featherlessBaseUrl: env("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"),
    featherlessChatModel: env("FEATHERLESS_CHAT_MODEL"),
    featherlessVisionModel: env("FEATHERLESS_VISION_MODEL"),
    featherlessImageModel: env("FEATHERLESS_IMAGE_MODEL"),
    featherlessTemperature: envFloat("FEATHERLESS_TEMPERATURE", 0.7),
    openAiApiKey: env("OPENAI_API_KEY"),
    openAiImageModel: env("OPENAI_IMAGE_MODEL", "gpt-image-1-mini"),
    openAiImageSize: env("OPENAI_IMAGE_SIZE", "1024x1024"),
    openAiImageQuality: env("OPENAI_IMAGE_QUALITY", "low"),
    telegramBotToken: env("TELEGRAM_BOT_TOKEN"),
    telegramChatId: env("TELEGRAM_CHAT_ID"),
    researchAgentMention: env("RESEARCH_AGENT_MENTION", "@Lead Scout"),
    visualInspectorAgentMention: env("VISUAL_INSPECTOR_AGENT_MENTION", "@Visual Inspector"),
    copywriterAgentMention: env("COPYWRITER_AGENT_MENTION", "@Pitch Copywriter"),
    designAgentMention: env("DESIGN_AGENT_MENTION", "@Food Design Director"),
    agencyName: env("AGENCY_NAME")
  };

  if (options.requireExa && !config.exaApiKey) {
    throw new Error("EXA_API_KEY is required. Mock restaurant leads are disabled.");
  }
  if (options.requireFeatherless && (!config.featherlessApiKey || !config.featherlessChatModel || !config.featherlessVisionModel || !config.featherlessImageModel)) {
    throw new Error("FEATHERLESS_API_KEY, FEATHERLESS_CHAT_MODEL, FEATHERLESS_VISION_MODEL, and FEATHERLESS_IMAGE_MODEL are required.");
  }
  if (options.requireTelegram && (!config.telegramBotToken || !config.telegramChatId)) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for delivery.");
  }
  if (!config.agencyName) {
    throw new Error("AGENCY_NAME is required. Set your actual owner/agency name; placeholder defaults are disabled.");
  }

  return config;
}

function env(name: string, defaultValue = ""): string {
  const value = process.env[name];
  return value == null || value === "" ? defaultValue : value;
}

function envInt(name: string, defaultValue: number): number {
  const value = env(name);
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got ${value}`);
  return parsed;
}

function envFloat(name: string, defaultValue: number): number {
  const value = env(name);
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be a number, got ${value}`);
  return parsed;
}
