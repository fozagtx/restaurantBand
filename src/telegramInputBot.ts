import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parseResearchTask } from "./agents/taskParser.js";
import { composeCopyPackage } from "./services/copywriter.js";
import { createDesignPackage } from "./services/featherlessDesign.js";
import { findRestaurantCandidates } from "./services/exaResearch.js";
import { sendDesignPackageToTelegram, sendTelegramMessage } from "./services/telegram.js";
import { inspectCandidatePacket } from "./services/visualInspection.js";
import { loadConfig, type RuntimeConfig } from "./shared/config.js";
import { slugify } from "./shared/utils.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: {
      id?: number | string;
    };
    text?: string;
    from?: {
      is_bot?: boolean;
    };
  };
};

type TelegramUpdatesResponse = {
  ok?: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

const offsetPath = "outputs/telegram-bot-offset.json";

export async function runTelegramInputBot(options: { signal?: AbortSignal } = {}): Promise<void> {
  const config = loadConfig({ requireExa: true, requireFeatherless: true, requireTelegram: true });
  let offset = await loadOffset();
  if (offset === null) {
    const existing = await getUpdates(config, undefined, 0);
    offset = nextOffset(existing);
    await saveOffset(offset);
  }
  let pollingOffset = offset;

  console.log("Telegram input bot running. Send /lead find 1 restaurant in Austin, TX with bad food/menu images");
  await sendTelegramMessage(
    "✅ Telegram input is ready.\nSend: /lead find 1 restaurant in Austin, TX with bad food/menu images",
    config
  ).catch((error) => console.warn(`[Telegram Input] ready message failed: ${error instanceof Error ? error.message : String(error)}`));

  while (!options.signal?.aborted) {
    const updates: TelegramUpdate[] = await getUpdates(config, pollingOffset, 25).catch((error) => {
      console.warn(`[Telegram Input] polling failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    for (const update of updates) {
      pollingOffset = update.update_id + 1;
      await saveOffset(pollingOffset);
      await handleUpdate(update, config).catch(async (error) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error(`[Telegram Input] command failed: ${text}`);
        await sendTelegramMessage(`❌ Telegram lead run failed: ${text}`, config).catch(() => undefined);
      });
    }
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const shutdown = (): void => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await runTelegramInputBot({ signal: controller.signal });
}

async function handleUpdate(update: TelegramUpdate, config: RuntimeConfig): Promise<void> {
  const message = update.message;
  if (!message) return;
  const text = message?.text?.trim();
  if (!text || message?.from?.is_bot) return;
  if (String(message.chat?.id ?? "") !== String(config.telegramChatId)) return;

  if (/^\/(?:start|help)\b/i.test(text)) {
    await sendTelegramMessage(
      "Use /lead followed by the search.\nExample: /lead find 1 restaurant in Austin, TX with bad food/menu images",
      config
    );
    return;
  }

  const request = extractLeadRequest(text, config);
  if (!request) return;
  await runLeadWorkflow(request, config);
}

async function runLeadWorkflow(request: string, config: RuntimeConfig): Promise<void> {
  await sendTelegramMessage("🧭 Lead Scout: parsing the restaurant lead request.", config);
  const task = await parseResearchTask(request, config);

  await sendTelegramMessage(`🔎 Lead Scout: searching for up to ${task.limit} validated ${task.cuisine} leads in ${task.location}.`, config);
  const candidates = await findRestaurantCandidates({ ...task, config });
  if (!candidates.leads.length) {
    await sendTelegramMessage(`⚠️ Lead Scout found no qualified ${task.cuisine} prospects in ${task.location}.`, config);
    return;
  }

  await sendTelegramMessage(`👁 Visual Inspector: auditing public images for ${candidates.leads.length} candidate${candidates.leads.length === 1 ? "" : "s"}.`, config);
  const research = await inspectCandidatePacket(candidates, config);
  if (!research.leads.length) {
    await sendTelegramMessage("⚠️ Visual Inspector found no validated visual-refresh leads. Nothing was sent to copy/design.", config);
    return;
  }

  await sendTelegramMessage(`✍️ Pitch Copywriter: writing owner-ready copy for ${research.leads.length} lead${research.leads.length === 1 ? "" : "s"}.`, config);
  const copyPackage = await composeCopyPackage(research, config);

  await sendTelegramMessage(`🎨 Food Design Director: building image assets for ${copyPackage.copy.length} lead${copyPackage.copy.length === 1 ? "" : "s"}.`, config);
  const designPackage = await createDesignPackage(copyPackage, config);

  await mkdir("outputs", { recursive: true });
  const outputPath = `outputs/telegram-${slugify(`${task.location}-${task.cuisine}`)}-${Date.now()}.json`;
  await writeFile(outputPath, JSON.stringify(designPackage, null, 2));

  await sendTelegramMessage("📬 Delivery: sending the outreach packet and generated image.", config);
  const deliveryStatus = await sendDesignPackageToTelegram(designPackage, config);
  await sendTelegramMessage(`✅ Done. ${deliveryStatus}\nSaved: ${outputPath}`, config);
}

function extractLeadRequest(text: string, config: RuntimeConfig): string | null {
  const commandMatch = text.match(/^\/(?:lead|find)(?:@\w+)?\s+([\s\S]+)/i);
  if (commandMatch?.[1]) return commandMatch[1].trim();

  const mention = config.researchAgentMention.replace(/^@+/, "").trim();
  const mentionPattern = new RegExp(`^@?${escapeRegExp(mention)}\\s+`, "i");
  if (mentionPattern.test(text)) return text.replace(mentionPattern, "").trim();
  if (/^@?Lead\s+Scout\s+/i.test(text)) return text.replace(/^@?Lead\s+Scout\s+/i, "").trim();

  const looksLikeLeadRequest = /\b(find|search|look)\b/i.test(text) && /\b(restaurant|restaurants|food|menu|sushi|pizza|taco|cafe|bakery)\b/i.test(text);
  return looksLikeLeadRequest ? text : null;
}

async function getUpdates(config: RuntimeConfig, offset?: number, timeout = 25): Promise<TelegramUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`);
  if (offset !== undefined) url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", String(timeout));
  url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
  const response = await fetch(url);
  const body = (await response.json()) as TelegramUpdatesResponse;
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram getUpdates failed (${response.status}): ${body.description ?? JSON.stringify(body)}`);
  }
  return body.result ?? [];
}

async function loadOffset(): Promise<number | null> {
  try {
    const data = JSON.parse(await readFile(offsetPath, "utf8")) as { offset?: unknown };
    return typeof data.offset === "number" && Number.isFinite(data.offset) ? data.offset : null;
  } catch {
    return null;
  }
}

async function saveOffset(offset: number): Promise<void> {
  await mkdir("outputs", { recursive: true });
  await writeFile(offsetPath, JSON.stringify({ offset }, null, 2));
}

function nextOffset(updates: TelegramUpdate[]): number {
  return updates.length ? Math.max(...updates.map((update) => update.update_id)) + 1 : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function isMain(metaUrl: string): boolean {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === metaUrl);
}
