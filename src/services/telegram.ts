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
    `${designPackage.agencyName} validated restaurant leads`,
    `Location: ${designPackage.copyPackage.location}`,
    `Cuisine: ${designPackage.copyPackage.cuisine}`,
    `Ready leads: ${designPackage.concepts.length}`,
    ""
  ];

  if (designPackage.copyPackage.research.notes.length) {
    lines.push("Screening notes:");
    designPackage.copyPackage.research.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push("");
  }

  designPackage.concepts.forEach((concept, index) => {
    const lead = designPackage.copyPackage.research.leads.find((item) => item.name === concept.restaurantName);
    const copy = copyByName.get(concept.restaurantName);
    lines.push(`${index + 1}. ${concept.restaurantName}`);
    lines.push(`Website: ${concept.website}`);
    if (lead) {
      lines.push(`Contact: ${formatContactPath(lead)}`);
      if (lead.contactPeople.length) {
        lines.push(`Named person: ${lead.contactPeople.map((person) => `${person.name} (${person.role})`).join("; ")}`);
      }
      lines.push(`Validation: official site loaded, contact path found, usable visual/menu evidence found`);
      lines.push(`Visual opportunity: ${lead.visualOpportunityScore}/100`);
      lines.push(`Why it is worth pitching: ${lead.visualOpportunityReason}`);
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
    lines.push("Hero image concept:");
    lines.push(concept.imagePrompts[0] ?? "No prompt returned");
    lines.push("");
    lines.push("Menu footer concept:");
    lines.push(concept.menuFooterPrompt);
    const generatedFiles = concept.generatedAssets.filter((asset) => asset.kind === "image_file");
    if (generatedFiles.length) {
      lines.push("");
      lines.push("Generated files:");
      generatedFiles.forEach((asset) => lines.push(`- ${truncate(asset.value, 800)}`));
    }
    lines.push("\n---\n");
  });
  return lines.join("\n");
}

function formatContactPath(lead: DesignPackage["copyPackage"]["research"]["leads"][number]): string {
  const values = [
    ...lead.emails,
    ...lead.phones,
    ...lead.sourceUrls.filter((url) => {
      try {
        const parsed = new URL(url);
        return /\b(contact|about|team|owner|chef|catering|events)\b/i.test(parsed.pathname);
      } catch {
        return false;
      }
    })
  ];
  return values.length ? values.join(", ") : "Not found";
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
