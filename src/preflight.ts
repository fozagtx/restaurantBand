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
    ["agent_config.yaml", existsSync("agent_config.yaml")],
    ["Band agent IDs in agent_config.yaml", hasBandAgentIds()],
    ["Band per-agent API keys in agent_config.yaml", hasBandAgentApiKeys()]
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
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  const agents = ["lead_scout", "visual_inspector", "pitch_copywriter", "food_design_director"];
  return agents.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /agent_id:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}

function hasBandAgentApiKeys(): boolean {
  if (!existsSync("agent_config.yaml")) return false;
  const text = readFileSync("agent_config.yaml", "utf8");
  const agents = ["lead_scout", "visual_inspector", "pitch_copywriter", "food_design_director"];
  return agents.every((agent) => {
    const block = text.match(new RegExp(`${agent}:\\n([\\s\\S]*?)(?=\\n\\S|$)`))?.[1] || "";
    return /api_key:\s*["']?[^"'\s<][^\n]*/.test(block);
  });
}
