import { existsSync, readFileSync } from "node:fs";

import { bandAgentKeys, getBandAgentEnvNames, hasBandAgentEnvValue } from "./agents/bandConfig.js";
import { loadConfig } from "./shared/config.js";

function main(): void {
  const config = loadConfig();
  const bandAgentIdCheck = getBandAgentCredentialCheck("AGENT_ID");
  const bandAgentKeyCheck = getBandAgentCredentialCheck("API_KEY");
  const checks = [
    ["EXA_API_KEY", Boolean(config.exaApiKey)],
    ["FEATHERLESS_API_KEY", Boolean(config.featherlessApiKey)],
    ["FEATHERLESS_CHAT_MODEL", Boolean(config.featherlessChatModel)],
    ["FEATHERLESS_VISION_MODEL", Boolean(config.featherlessVisionModel)],
    ["FEATHERLESS_IMAGE_MODEL", Boolean(config.featherlessImageModel)],
    ["OPENAI_API_KEY", Boolean(config.openAiApiKey)],
    ["OPENAI_IMAGE_MODEL", Boolean(config.openAiImageModel)],
    [bandAgentIdCheck.label, bandAgentIdCheck.ok],
    [bandAgentKeyCheck.label, bandAgentKeyCheck.ok]
  ] as const;

  let failed = false;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "OK" : "MISSING"} ${name}`);
    failed ||= !ok;
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log("Preflight passed.");
}

main();

function hasBandAgentIds(): boolean {
  if (bandAgentKeys.every((agent) => hasBandAgentEnvValue(agent, "AGENT_ID"))) return true;
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  return bandAgentKeys.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /agent_id:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}

function hasBandAgentApiKeys(): boolean {
  if (bandAgentKeys.every((agent) => hasBandAgentEnvValue(agent, "API_KEY"))) return true;
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  return bandAgentKeys.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /api_key:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}

function getBandAgentCredentialCheck(suffix: "AGENT_ID" | "API_KEY"): { label: string; ok: boolean } {
  const ok = suffix === "AGENT_ID" ? hasBandAgentIds() : hasBandAgentApiKeys();
  if (ok) {
    return { label: suffix === "AGENT_ID" ? "Band agent IDs" : "Band per-agent API keys", ok };
  }
  const missing = bandAgentKeys
    .filter((agent) => !hasBandAgentEnvValue(agent, suffix))
    .map((agent) => `${agent} (${getBandAgentEnvNames(agent, suffix)[0]})`);
  const label = `${suffix === "AGENT_ID" ? "Band agent IDs" : "Band per-agent API keys"} missing: ${missing.join(", ")}`;
  return { label, ok };
}
