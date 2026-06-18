import { Agent } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { loadRestaurantBandAgentConfig } from "./bandConfig.js";
import { createFoodDesignDirectorAdapter } from "./foodDesignDirector.js";
import { createLeadScoutAdapter } from "./leadScout.js";
import { createPitchCopywriterAdapter } from "./pitchCopywriter.js";
import { createVisualInspectorAdapter } from "./visualInspector.js";

const agentConfigs = [
  { key: "lead_scout", adapter: createLeadScoutAdapter() },
  { key: "visual_inspector", adapter: createVisualInspectorAdapter() },
  { key: "pitch_copywriter", adapter: createPitchCopywriterAdapter() },
  { key: "food_design_director", adapter: createFoodDesignDirectorAdapter() }
];

async function main(): Promise<void> {
  const config = loadConfig({ requireExa: true, requireFeatherless: true, requireTelegram: true });
  const agents = agentConfigs.map(({ key, adapter }) =>
    Agent.create({
      config: loadRestaurantBandAgentConfig(key),
      adapter,
      restUrl: config.bandRestUrl,
      wsUrl: config.bandWsUrl,
      agentConfig: {
        autoSubscribeExistingRooms: true
      }
    })
  );

  await Promise.all(agents.map((agent) => agent.start()));
  console.log(`Started ${agents.length} Band agents: ${agentConfigs.map((agent) => agent.key).join(", ")}`);

  const shutdown = async (): Promise<void> => {
    await Promise.all(agents.map((agent) => agent.stop()));
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
