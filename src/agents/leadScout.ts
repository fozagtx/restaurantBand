import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import { candidateResearchPacketSchema, copyPackageSchema, designPackageSchema, researchPacketSchema } from "../shared/schemas.js";
import { composeCopyPackage } from "../services/copywriter.js";
import { createDesignPackage } from "../services/featherlessDesign.js";
import { findRestaurantCandidates } from "../services/exaResearch.js";
import { inspectCandidatePacket } from "../services/visualInspection.js";
import { sendDesignPackageToTelegram } from "../services/telegram.js";
import { reportProgress } from "./collaboration.js";
import { runLoggedAgent } from "./agentLogging.js";
import { parseResearchTask } from "./taskParser.js";

export function createLeadScoutAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Lead Scout", message, tools, async () => {
    if (!isResearchRequest(message.content)) {
      console.log("[Lead Scout] ignored non-research message");
      return;
    }
    const config = loadConfig({ requireExa: true, requireFeatherless: true, requireTelegram: true });
    await reportProgress(tools, "🧭 Lead Scout: parsing the restaurant lead request.");
    const task = await parseResearchTask(message.content, config).catch(async (error) => {
      await tools.sendMessage(
        `I can run this, but I need at least cuisine/category and location. Count defaults to 2 validated leads, and search depth defaults to smart. Example: "find sushi restaurants in Austin, TX with boring food or menu photos".\n\nParser issue: ${error instanceof Error ? error.message : String(error)}`,
        [{ id: message.senderId }]
      );
      return null;
    });
    if (!task) return;
    await reportProgress(tools, `🔎 Lead Scout: searching for up to ${task.limit} validated ${task.cuisine} leads in ${task.location}.`);
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
    const candidatePacket = candidateResearchPacketSchema.parse(research);
    await reportProgress(
      tools,
      `👁 Visual Inspector: auditing public images for ${candidatePacket.leads.length} candidate${candidatePacket.leads.length === 1 ? "" : "s"}.`
    );
    const researchPacket = researchPacketSchema.parse(await inspectCandidatePacket(candidatePacket, config));
    if (!researchPacket.leads.length) {
      await tools.sendMessage(
        "Visual Inspector found no validated leads. Nothing was sent to copy/design because the candidate lacked usable weak menu-food evidence or a reliable contact path.",
        [{ id: message.senderId }]
      );
      return;
    }

    await reportProgress(tools, `✍️ Pitch Copywriter: writing cold DM/email copy for ${researchPacket.leads.length} lead${researchPacket.leads.length === 1 ? "" : "s"}.`);
    const copyPackage = copyPackageSchema.parse(await composeCopyPackage(researchPacket, config));

    await reportProgress(tools, `🎨 Food Design Director: generating menu-food asset package for ${copyPackage.copy.length} lead${copyPackage.copy.length === 1 ? "" : "s"}.`);
    const designPackage = designPackageSchema.parse(await createDesignPackage(copyPackage, config));
    designPackage.copyPackage.research.collaborationLog.push(
      action("Food Design Director", "telegram_delivery", `Sent final digest to Telegram chat ${config.telegramChatId}.`)
    );

    const deliveryStatus = await sendDesignPackageToTelegram(designPackage, config);
    await tools.sendMessage(`✅ Restaura workflow complete. ${deliveryStatus}`, [{ id: message.senderId }]);
  }));
}

function isResearchRequest(content: string): boolean {
  const normalized = content.replace(/@\[\[[^\]]+]]/g, "").toLowerCase();
  if (normalized.includes(" failed:")) return false;
  if (normalized.includes('"type": "candidate_research_packet"')) return false;
  if (normalized.includes('"type": "research_packet"')) return false;
  if (normalized.includes('"type": "copy_package"')) return false;
  const asksForSearch = /\b(quick|smart|deep|find|search|look)\b/.test(normalized);
  const foodBusiness = /\b(restaurant|restaurants|shop|shops|food|sushi|sushie|cafe|cafes|pizza|taco|bakery|bar)\b/.test(normalized);
  return asksForSearch && foodBusiness;
}
