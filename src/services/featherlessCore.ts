import { loadConfig, type RuntimeConfig } from "../shared/config.js";
import { createChatCompletion, type ChatMessage, type ChatMessageContent } from "./openAiCompatible.js";

export async function runFeatherlessChat(input: {
  system: string;
  user: string;
  config?: RuntimeConfig;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const config = input.config ?? loadConfig({ requireFeatherless: true });
  return createChatCompletion({
    apiKey: config.featherlessApiKey,
    baseUrl: config.featherlessBaseUrl,
    model: input.model ?? config.featherlessChatModel,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user }
    ] satisfies ChatMessage[],
    temperature: input.temperature ?? config.featherlessTemperature,
    maxTokens: input.maxTokens ?? 1600
  });
}

export async function runFeatherlessVision(input: {
  system: string;
  userContent: ChatMessageContent;
  config?: RuntimeConfig;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const config = input.config ?? loadConfig({ requireFeatherless: true });
  return createChatCompletion({
    apiKey: config.featherlessApiKey,
    baseUrl: config.featherlessBaseUrl,
    model: input.model ?? config.featherlessVisionModel,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.userContent }
    ] satisfies ChatMessage[],
    temperature: input.temperature ?? 0.1,
    maxTokens: input.maxTokens ?? 1200
  });
}
