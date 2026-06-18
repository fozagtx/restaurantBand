import { loadAgentConfig, type AgentCredentials } from "@band-ai/sdk";

export const bandAgentKeys = ["lead_scout", "visual_inspector", "pitch_copywriter", "food_design_director"] as const;
type CredentialSuffix = "AGENT_ID" | "API_KEY";

const defaultBandAgentIds: Record<(typeof bandAgentKeys)[number], string> = {
  lead_scout: "f60c8b69-c5a5-4d32-ab8b-62c0ba4a2e91",
  visual_inspector: "40b8730e-51ad-40be-a9eb-76d9e274d87d",
  pitch_copywriter: "b56d76cd-d396-46e0-b652-77bbba99baf7",
  food_design_director: "63eff489-3e7e-42eb-b8f3-7ff2bdf69060"
};

export function loadBandAgentConfig(agentKey: string): AgentCredentials {
  const config = safeLoadAgentConfig(agentKey);
  const envConfig = loadAgentConfigFromEnv(agentKey);
  const defaultAgentId = isBandAgentKey(agentKey) ? defaultBandAgentIds[agentKey] : "";
  const agentId = firstUsableString(config.agentId, envConfig.agentId, defaultAgentId);
  const apiKey = isPlaceholder(config.apiKey) ? envConfig.apiKey : config.apiKey;
  if (!agentId || isPlaceholder(agentId)) {
    throw new Error(
      `${agentKey} is missing a real Band agent ID. agent_config.yaml is local-only and is not deployed to Railway. ` +
        `Set one of these Railway variables: ${getBandAgentEnvNames(agentKey, "AGENT_ID").join(", ")}.`
    );
  }
  if (!apiKey || isPlaceholder(apiKey)) {
    throw new Error(
      `${agentKey} is missing its Band API key. agent_config.yaml is local-only and is not deployed to Railway. ` +
        `Set one of these Railway variables: ${getBandAgentEnvNames(agentKey, "API_KEY").join(", ")}.`
    );
  }
  return { agentId, apiKey };
}

export function getBandAgentEnvNames(agentKey: string, suffix: CredentialSuffix): string[] {
  const upper = agentKey.toUpperCase();
  if (suffix === "AGENT_ID") {
    return [
      `BAND_${upper}_AGENT_ID`,
      `BAND_${upper}_ID`,
      `${upper}_AGENT_ID`,
      `${upper}_ID`,
      `BAND_${upper}_AGENT_UUID`,
      `${upper}_AGENT_UUID`
    ];
  }
  return [
      `BAND_${upper}_API_KEY`,
      `BAND_${upper}_KEY`,
      `BAND_${upper}_AGENT_API_KEY`,
      `${upper}_API_KEY`,
      `${upper}_KEY`,
      `${upper}_AGENT_API_KEY`,
      `${upper}_BAND_API_KEY`
    ];
  }

export function hasBandAgentEnvValue(agentKey: string, suffix: CredentialSuffix): boolean {
  return Boolean(readBandAgentEnvValue(agentKey, suffix));
}

function safeLoadAgentConfig(agentKey: string): AgentCredentials {
  try {
    return loadAgentConfig(agentKey);
  } catch {
    return { agentId: "", apiKey: "" };
  }
}

function loadAgentConfigFromEnv(agentKey: string): AgentCredentials {
  return {
    agentId: readBandAgentEnvValue(agentKey, "AGENT_ID"),
    apiKey: readBandAgentEnvValue(agentKey, "API_KEY")
  };
}

function readBandAgentEnvValue(agentKey: string, suffix: CredentialSuffix): string {
  for (const name of getBandAgentEnvNames(agentKey, suffix)) {
    const value = process.env[name];
    if (typeof value === "string" && !isPlaceholder(value)) return value.trim();
  }
  return "";
}

function isBandAgentKey(value: string): value is (typeof bandAgentKeys)[number] {
  return bandAgentKeys.some((agentKey) => agentKey === value);
}

function firstUsableString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && !isPlaceholder(value)) return value.trim();
  }
  return "";
}

function isPlaceholder(value: unknown): boolean {
  return typeof value !== "string" || !value.trim() || value.includes("<") || value.includes(">");
}
