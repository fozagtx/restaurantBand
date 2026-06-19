import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { copyPackageSchema, researchPacketSchema } from "../shared/schemas.js";
import { composeCopyPackage } from "../services/copywriter.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress, sendHandoff } from "./collaboration.js";
import { hasHandoffPayloadType, isRestauraHandoffMessage, parseHandoffPayload } from "./handoffStore.js";

export function createPitchCopywriterAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Pitch Copywriter", message, tools, async () => {
    if (!hasHandoffPayloadType(message.content, "research_packet", message.metadata)) {
      if (isRestauraHandoffMessage(message.content)) {
        await tools.sendMessage("Pitch Copywriter received a Restaura handoff, but the packet was missing or the wrong type. Restart the workflow from Lead Scout.", [{ id: message.senderId }]);
      }
      console.log("[Pitch Copywriter] ignored non-research-packet message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true });
    const research = parseHandoffPayload(message.content, researchPacketSchema, message.metadata);
    if (!research.leads.length) {
      await tools.sendMessage("Pitch Copywriter received zero validated leads, so no copy package was created.", [{ id: message.senderId }]);
      return;
    }
    await reportProgress(tools, `✍️ Pitch Copywriter: writing owner-ready copy for ${research.leads.length} lead${research.leads.length === 1 ? "" : "s"}.`);
    const copyPackage = copyPackageSchema.parse(await composeCopyPackage(research, config));
    await sendHandoff(
      tools,
      config.designAgentMention,
      "designer",
      "Pitch Copywriter finished the owner-ready copy. Create the image asset package and deliver the digest to Telegram.",
      copyPackage
    );
  }));
}
