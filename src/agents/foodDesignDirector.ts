import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import { copyPackageSchema, designPackageSchema } from "../shared/schemas.js";
import { createDesignPackage } from "../services/featherlessDesign.js";
import { sendDesignPackageToTelegram } from "../services/telegram.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress } from "./collaboration.js";
import { hasHandoffPayloadType, isRestauraHandoffMessage, parseHandoffPayload } from "./handoffStore.js";

export function createFoodDesignDirectorAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Food Design Director", message, tools, async () => {
    if (!hasHandoffPayloadType(message.content, "copy_package", message.metadata)) {
      if (isRestauraHandoffMessage(message.content)) {
        await tools.sendMessage("Food Design Director received a Restaura handoff, but the packet was missing or the wrong type. Restart the workflow from Lead Scout.", [{ id: message.senderId }]);
      }
      console.log("[Food Design Director] ignored non-copy-package message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true, requireTelegram: true });
    const copyPackage = parseHandoffPayload(message.content, copyPackageSchema, message.metadata);
    if (!copyPackage.copy.length) {
      await tools.sendMessage("Food Design Director received zero copy packs, so no design package was sent to Telegram.", [{ id: message.senderId }]);
      return;
    }
    await reportProgress(tools, `🎨 Food Design Director: building image assets for ${copyPackage.copy.length} lead${copyPackage.copy.length === 1 ? "" : "s"}.`);
    const designPackage = designPackageSchema.parse(await createDesignPackage(copyPackage, config));
    designPackage.copyPackage.research.collaborationLog.push(
      action("Food Design Director", "telegram_delivery", `Sent final digest to Telegram chat ${config.telegramChatId}.`)
    );
    const deliveryStatus = await sendDesignPackageToTelegram(designPackage, config);
    await tools.sendMessage(`Workflow complete. ${deliveryStatus}`, [{ id: message.senderId }]);
  }));
}
