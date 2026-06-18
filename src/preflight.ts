import { existsSync, readFileSync } from "node:fs";

import { loadConfig } from "./shared/config.js";

function main(): void {
  const config = loadConfig();
  const checks = [
    ["EXA_API_KEY", Boolean(config.exaApiKey)],
    ["FEATHERLESS_API_KEY", Boolean(config.featherlessApiKey)],
    ["FEATHERLESS_CHAT_MODEL", Boolean(config.featherlessChatModel)],
    ["FEATHERLESS_VISION_MODEL", Boolean(config.featherlessVisionModel)],
    ["FEATHERLESS_IMAGE_MODEL", Boolean(config.featherlessImageModel)],
    ["OPENAI_API_KEY", Boolean(config.openAiApiKey)],
    ["OPENAI_IMAGE_MODEL", Boolean(config.openAiImageModel)],
    ["Band agent IDs", hasBandAgentIds()],
    ["Band per-agent API keys", hasBandAgentApiKeys()]
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
  if (hasBandAgentEnv("AGENT_ID")) return true;
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  const agents = ["lead_scout", "visual_inspector", "pitch_copywriter", "food_design_director"];
  return agents.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /agent_id:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}

function hasBandAgentApiKeys(): boolean {
  if (hasBandAgentEnv("API_KEY")) return true;
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  const agents = ["lead_scout", "visual_inspector", "pitch_copywriter", "food_design_director"];
  return agents.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /api_key:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}

function hasBandAgentEnv(suffix: "AGENT_ID" | "API_KEY"): boolean {
  const agents = ["LEAD_SCOUT", "VISUAL_INSPECTOR", "PITCH_COPYWRITER", "FOOD_DESIGN_DIRECTOR"];
  return agents.every((agent) => Boolean(process.env[`BAND_${agent}_${suffix}`]));
}
