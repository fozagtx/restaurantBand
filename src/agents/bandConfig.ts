import { loadAgentConfig, type AgentCredentials } from "@band-ai/sdk";

export function loadRestaurantBandAgentConfig(agentKey: string): AgentCredentials {
  const config = loadAgentConfig(agentKey);
  if (!config.agentId || isPlaceholder(config.agentId)) {
    throw new Error(`${agentKey} is missing a real Band agent_id in agent_config.yaml.`);
  }
  if (!config.apiKey || isPlaceholder(config.apiKey)) {
    throw new Error(`${agentKey} is missing its Band api_key in agent_config.yaml.`);
  }
  return config;
}

function isPlaceholder(value: unknown): boolean {
  return typeof value !== "string" || !value.trim() || value.includes("<") || value.includes(">");
}
