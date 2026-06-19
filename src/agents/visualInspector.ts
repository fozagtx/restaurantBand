import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { candidateResearchPacketSchema, researchPacketSchema } from "../shared/schemas.js";
import { inspectCandidatePacket } from "../services/visualInspection.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress, sendHandoff } from "./collaboration.js";
import { hasHandoffPayloadType, isRestauraHandoffMessage, parseHandoffPayload } from "./handoffStore.js";

export function createVisualInspectorAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Visual Inspector", message, tools, async () => {
    if (!hasHandoffPayloadType(message.content, "candidate_research_packet", message.metadata)) {
      if (isRestauraHandoffMessage(message.content)) {
        await tools.sendMessage("Visual Inspector received a Restaura handoff, but the packet was missing or the wrong type. Restart the workflow from Lead Scout.", [{ id: message.senderId }]);
      }
      console.log("[Visual Inspector] ignored non-candidate-research message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true });
    const candidatePacket = parseHandoffPayload(message.content, candidateResearchPacketSchema, message.metadata);
    await reportProgress(
      tools,
      `👁 Visual Inspector: auditing public images for ${candidatePacket.leads.length} candidate${candidatePacket.leads.length === 1 ? "" : "s"}.`
    );
    const researchPacket = researchPacketSchema.parse(await inspectCandidatePacket(candidatePacket, config));
    if (!researchPacket.leads.length) {
      await tools.sendMessage(
        "Visual Inspector found no validated visual-refresh leads in this packet. Nothing was sent to copy/design because every candidate lacked usable weak visual evidence or a reliable contact path.",
        [{ id: message.senderId }]
      );
      return;
    }
    await sendHandoff(
      tools,
      config.copywriterAgentMention,
      "copywriter",
      "Visual inspection handoff from Visual Inspector. These leads now include Featherless image audits and visual opportunity scores.",
      researchPacket
    );
  }));
}
