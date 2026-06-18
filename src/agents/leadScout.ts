import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import { candidateResearchPacketSchema } from "../shared/schemas.js";
import { findRestaurantCandidates } from "../services/exaResearch.js";
import { reportProgress, sendHandoff } from "./collaboration.js";
import { runLoggedAgent } from "./agentLogging.js";
import { parseResearchTask } from "./taskParser.js";

export function createLeadScoutAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Lead Scout", message, tools, async () => {
    if (!isResearchRequest(message.content)) {
      console.log("[Lead Scout] ignored non-research message");
      return;
    }
    const config = loadConfig({ requireExa: true, requireFeatherless: true });
    await reportProgress(tools, "Lead Scout received the task and is parsing search parameters with Featherless.");
    const task = await parseResearchTask(message.content, config).catch(async (error) => {
      await tools.sendMessage(
        `I can run this, but I need at least cuisine/category and location. Count defaults to 2 validated leads, and search depth defaults to smart. Example: "find sushi restaurants in Austin, TX with boring food or menu photos".\n\nParser issue: ${error instanceof Error ? error.message : String(error)}`,
        [{ id: message.senderId }]
      );
      return null;
    });
    if (!task) return;
    await reportProgress(tools, `Lead Scout is searching Exa for up to ${task.limit} validated ${task.cuisine} leads in ${task.location}.`);
    const research = await findRestaurantCandidates({ ...task, config });
    if (!research.leads.length) {
      await tools.sendMessage(
        `Lead Scout found no qualified ${task.cuisine} prospects in ${task.location}. I did not hand off to design because the workflow only moves contactable leads with visual/menu evidence forward.`,
        [{ id: message.senderId }]
      );
      return;
    }

    research.collaborationLog.push(
      action("Lead Scout", "delegate_visual_inspection", `Delegated ${research.leads.length} candidates to Visual Inspector for Featherless vision audit.`)
    );
    const payload = candidateResearchPacketSchema.parse(research);
    await sendHandoff(
      tools,
      config.visualInspectorAgentMention,
      "visual inspector",
      `Lead Scout found ${payload.leads.length} validated candidate${payload.leads.length === 1 ? "" : "s"} for image inspection.`,
      payload
    );
  }));
}

function isResearchRequest(content: string): boolean {
  const normalized = content.replace(/@\[\[[^\]]+]]/g, "").toLowerCase();
  if (normalized.includes(" failed:")) return false;
  if (normalized.includes('"type": "candidate_research_packet"')) return false;
  if (normalized.includes('"type": "research_packet"')) return false;
  if (normalized.includes('"type": "copy_package"')) return false;
  const asksForSearch = /\b(quick|smart|deep|find|search|look|lead|leads)\b/.test(normalized);
  const foodBusiness = /\b(restaurant|restaurants|shop|shops|food|sushi|sushie|cafe|cafes|pizza|taco|bakery|bar)\b/.test(normalized);
  return asksForSearch && foodBusiness;
}
