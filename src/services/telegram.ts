import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { loadConfig, type RuntimeConfig } from "../shared/config.js";
import type { DesignPackage } from "../shared/schemas.js";
import { truncate } from "../shared/utils.js";

const telegramLimit = 3900;

export async function sendDesignPackageToTelegram(designPackage: DesignPackage, config = loadConfig({ requireTelegram: true })): Promise<string> {
  const text = formatDigest(designPackage);
  for (const chunk of splitTelegramMessage(text)) {
    await sendTelegramMessage(chunk, config);
  }

  let imageCount = 0;
  for (const concept of designPackage.concepts) {
    for (const asset of concept.generatedAssets) {
      if (asset.kind === "image_file") {
        await sendTelegramPhoto(asset.value, `${concept.restaurantName} Featherless image asset`, config);
        imageCount += 1;
      }
      if (asset.kind === "image_url") {
        await sendTelegramMessage(`${concept.restaurantName} image URL:\n${asset.value}`, config);
      }
    }
  }

  return `Sent Telegram digest with ${designPackage.concepts.length} leads and ${imageCount} uploaded image files.`;
}

export function formatDigest(designPackage: DesignPackage): string {
  const copyByName = new Map(designPackage.copyPackage.copy.map((copy) => [copy.restaurantName, copy]));
  const lines: string[] = [
    `${designPackage.agencyName} restaurant lead digest`,
    `Location: ${designPackage.copyPackage.location}`,
    `Cuisine: ${designPackage.copyPackage.cuisine}`,
    `Exa requests: ${designPackage.copyPackage.research.exaRequestCount}`,
    `Featherless concepts: ${designPackage.concepts.length}`,
    ""
  ];

  lines.push("Collaboration log:");
  for (const event of designPackage.copyPackage.research.collaborationLog) {
    lines.push(`- ${event.at} | ${event.agent} | ${event.action}: ${event.details}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  designPackage.concepts.forEach((concept, index) => {
    const lead = designPackage.copyPackage.research.leads.find((item) => item.name === concept.restaurantName);
    const copy = copyByName.get(concept.restaurantName);
    lines.push(`${index + 1}. ${concept.restaurantName}`);
    lines.push(`Website: ${concept.website}`);
    if (lead) {
      lines.push(`Emails: ${lead.emails.length ? lead.emails.join(", ") : "Not found"}`);
      lines.push(`Phones: ${lead.phones.length ? lead.phones.join(", ") : "Not found"}`);
      lines.push(`Socials: ${lead.socialUrls.length ? lead.socialUrls.join(", ") : "Not found"}`);
      lines.push(
        `People: ${
          lead.contactPeople.length
            ? lead.contactPeople.map((person) => `${person.name} (${person.role}) - ${person.sourceUrl}`).join("; ")
            : "Not found"
        }`
      );
      lines.push(`Visual score: ${lead.visualOpportunityScore}/100`);
      lines.push(`Reason: ${lead.visualOpportunityReason}`);
      lines.push(
        `Image audit: ${lead.imageAudit.status === "audited" ? `${lead.imageAudit.verdict}, ${lead.imageAudit.boringScore}/100 boring score via ${lead.imageAudit.model}` : "not audited; no image URLs found"}`
      );
    }
    if (copy) {
      lines.push("");
      lines.push("Email subjects:");
      copy.emailSubjects.forEach((subject) => lines.push(`- ${subject}`));
      lines.push("");
      lines.push("Cold email:");
      lines.push(copy.coldEmail);
      lines.push("");
      lines.push("DM:");
      lines.push(copy.instagramDm);
    }
    lines.push("");
    lines.push(`Featherless model: ${concept.featherlessModel}`);
    lines.push("Image prompt:");
    lines.push(concept.imagePrompts[0] ?? "No prompt returned");
    lines.push("");
    lines.push("Menu footer prompt:");
    lines.push(concept.menuFooterPrompt);
    lines.push("");
    lines.push("Assets:");
    concept.generatedAssets.forEach((asset) => lines.push(`- ${asset.kind}: ${truncate(asset.value, 800)}`));
    lines.push("\n---\n");
  });
  return lines.join("\n");
}

async function sendTelegramMessage(text: string, config: RuntimeConfig): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChatId, text })
  });
  await assertTelegramOk(response);
}

async function sendTelegramPhoto(path: string, caption: string, config: RuntimeConfig): Promise<void> {
  await stat(path);
  const form = new FormData();
  form.append("chat_id", config.telegramChatId);
  form.append("caption", truncate(caption, 1000));
  const file = await import("node:fs/promises").then((fs) => fs.readFile(path));
  form.append("photo", new Blob([file], { type: "image/png" }), path.split("/").pop() ?? "image.png");
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`, {
    method: "POST",
    body: form
  });
  await assertTelegramOk(response);
}

async function assertTelegramOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Telegram API failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { ok?: boolean; description?: string };
  if (!body.ok) throw new Error(`Telegram API returned ok=false: ${body.description ?? JSON.stringify(body)}`);
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= telegramLimit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const block of text.split("\n---\n")) {
    const next = current ? `${current}\n---\n${block}` : block;
    if (next.length > telegramLimit && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
