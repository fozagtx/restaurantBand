import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { candidateResearchPacketSchema, hasJsonPayloadType, parseJsonPayload, researchPacketSchema } from "../shared/schemas.js";
import { inspectCandidatePacket } from "../services/visualInspection.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress, sendHandoff } from "./collaboration.js";

export function createVisualInspectorAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Visual Inspector", message, tools, async () => {
    if (!hasJsonPayloadType(message.content, "candidate_research_packet")) {
      console.log("[Visual Inspector] ignored non-candidate-research message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true });
    const candidatePacket = parseJsonPayload(message.content, candidateResearchPacketSchema);
    await reportProgress(
      tools,
      `Visual Inspector received ${candidatePacket.leads.length} candidates and is auditing public image URLs with Featherless vision.`
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
