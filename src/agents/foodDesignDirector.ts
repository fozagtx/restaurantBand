import { GenericAdapter } from "@band-ai/sdk";

import { loadConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import { copyPackageSchema, designPackageSchema, hasJsonPayloadType, parseJsonPayload } from "../shared/schemas.js";
import { createDesignPackage } from "../services/featherlessDesign.js";
import { sendDesignPackageToTelegram } from "../services/telegram.js";
import { runLoggedAgent } from "./agentLogging.js";
import { reportProgress } from "./collaboration.js";

export function createFoodDesignDirectorAdapter(): GenericAdapter {
  return new GenericAdapter(async ({ message, tools }) => runLoggedAgent("Food Design Director", message, tools, async () => {
    if (!hasJsonPayloadType(message.content, "copy_package")) {
      console.log("[Food Design Director] ignored non-copy-package message");
      return;
    }
    const config = loadConfig({ requireFeatherless: true, requireTelegram: true });
    const copyPackage = parseJsonPayload(message.content, copyPackageSchema);
    if (!copyPackage.copy.length) {
      await tools.sendMessage("Food Design Director received zero copy packs, so no design package was sent to Telegram.", [{ id: message.senderId }]);
      return;
    }
    await reportProgress(tools, `Food Design Director received ${copyPackage.copy.length} copy packs and is calling Featherless image/design model.`);
    const designPackage = designPackageSchema.parse(await createDesignPackage(copyPackage, config));
    designPackage.copyPackage.research.collaborationLog.push(
      action("Food Design Director", "telegram_delivery", `Sent final digest to Telegram chat ${config.telegramChatId}.`)
    );
    const deliveryStatus = await sendDesignPackageToTelegram(designPackage, config);
    await tools.sendMessage(`Workflow complete. ${deliveryStatus}`, [{ id: message.senderId }]);
  }));
}
