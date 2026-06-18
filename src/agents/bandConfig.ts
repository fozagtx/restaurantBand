import { loadAgentConfig, type AgentCredentials } from "@band-ai/sdk";

export function loadRestaurantBandAgentConfig(agentKey: string): AgentCredentials {
  const config = safeLoadAgentConfig(agentKey);
  const envConfig = loadAgentConfigFromEnv(agentKey);
  const agentId = isPlaceholder(config.agentId) ? envConfig.agentId : config.agentId;
  const apiKey = isPlaceholder(config.apiKey) ? envConfig.apiKey : config.apiKey;
  if (!agentId || isPlaceholder(agentId)) {
    throw new Error(`${agentKey} is missing a real Band agent ID. Set agent_config.yaml locally or ${envPrefix(agentKey)}_AGENT_ID in Railway.`);
  }
  if (!apiKey || isPlaceholder(apiKey)) {
    throw new Error(`${agentKey} is missing its Band API key. Set agent_config.yaml locally or ${envPrefix(agentKey)}_API_KEY in Railway.`);
  }
  return { agentId, apiKey };
}

function safeLoadAgentConfig(agentKey: string): AgentCredentials {
  try {
    return loadAgentConfig(agentKey);
  } catch {
    return { agentId: "", apiKey: "" };
  }
}

function loadAgentConfigFromEnv(agentKey: string): AgentCredentials {
  const prefix = envPrefix(agentKey);
  return {
    agentId: process.env[`${prefix}_AGENT_ID`] ?? "",
    apiKey: process.env[`${prefix}_API_KEY`] ?? ""
  };
}

function envPrefix(agentKey: string): string {
  return `BAND_${agentKey.toUpperCase()}`;
}

function isPlaceholder(value: unknown): boolean {
  return typeof value !== "string" || !value.trim() || value.includes("<") || value.includes(">");
}
