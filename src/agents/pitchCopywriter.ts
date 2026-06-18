import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { copyPackageSchema, hasJsonPayloadType, parseJsonPayload, researchPacketSchema } from "../shared/schemas.js";
import { composeCopyPackage } from "../services/copywriter.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress, sendHandoff } from "./collaboration.js";

export function createPitchCopywriterAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Pitch Copywriter", message, tools, async () => {
    if (!hasJsonPayloadType(message.content, "research_packet", message.metadata)) {
      console.log("[Pitch Copywriter] ignored non-research-packet message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true });
    const research = parseJsonPayload(message.content, researchPacketSchema, message.metadata);
    if (!research.leads.length) {
      await tools.sendMessage("Pitch Copywriter received zero validated leads, so no copy package was created.", [{ id: message.senderId }]);
      return;
    }
    await reportProgress(tools, `Pitch Copywriter received ${research.leads.length} leads and is writing Featherless-powered outreach copy.`);
    const copyPackage = copyPackageSchema.parse(await composeCopyPackage(research, config));
    await sendHandoff(
      tools,
      config.designAgentMention,
      "designer",
      "Copy handoff from Pitch Copywriter. Use the copy package and research evidence to create Featherless image/design prompts, then deliver the digest to Telegram.",
      copyPackage
    );
  }));
}
