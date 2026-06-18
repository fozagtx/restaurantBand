import { mkdir, writeFile } from "node:fs/promises";

import { loadConfig } from "./shared/config.js";
import { findRestaurantCandidates } from "./services/exaResearch.js";
import { composeCopyPackage } from "./services/copywriter.js";
import { createDesignPackage } from "./services/featherlessDesign.js";
import { formatDigest, sendDesignPackageToTelegram } from "./services/telegram.js";
import { inspectCandidatePacket } from "./services/visualInspection.js";
import { DAILY_VALIDATED_LEAD_TARGET, capLeadLimit } from "./shared/leadPolicy.js";
import { slugify } from "./shared/utils.js";

type CliOptions = {
  location: string;
  cuisine: string;
  limit: number;
  searchMode: "quick" | "smart" | "deep";
  exaSearchType: "fast" | "auto" | "deep" | "deep-reasoning";
  sendTelegram: boolean;
  writeJson: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig({
    requireExa: true,
    requireFeatherless: true,
    requireTelegram: options.sendTelegram
  });

  console.log(`Searching Exa for ${options.limit} ${options.cuisine} leads in ${options.location} using ${options.searchMode} mode (${options.exaSearchType})...`);
  const candidates = await findRestaurantCandidates({ ...options, config });
  console.log(`Found ${candidates.leads.length} candidate leads via ${candidates.exaRequestCount} Exa requests.`);

  const research = await inspectCandidatePacket(candidates, config);
  console.log(`Visual Inspector validated ${research.leads.length} leads with Featherless vision.`);
  if (!research.leads.length) {
    console.log("No validated visual-refresh leads found. Stopping before copy/design.");
    return;
  }

  const copyPackage = await composeCopyPackage(research, config);
  console.log("Copywriter completed expert outreach copy.");

  const designPackage = await createDesignPackage(copyPackage, config);
  console.log(`Design agent completed ${designPackage.concepts.length} image asset packages.`);

  if (options.writeJson) {
    await mkdir("outputs", { recursive: true });
    const outputPath = `outputs/${slugify(`${options.location}-${options.cuisine}`)}-${Date.now()}.json`;
    await writeFile(outputPath, JSON.stringify(designPackage, null, 2));
    console.log(`Wrote structured output: ${outputPath}`);
  }

  if (options.sendTelegram) {
    console.log(await sendDesignPackageToTelegram(designPackage, config));
  } else {
    console.log("\nTelegram preview:\n");
    console.log(formatDigest(designPackage));
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    location: "",
    cuisine: "",
    limit: Number.NaN,
    searchMode: "" as CliOptions["searchMode"],
    exaSearchType: "" as CliOptions["exaSearchType"],
    sendTelegram: false,
    writeJson: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--location" && next) {
      options.location = next;
      index += 1;
    } else if (arg === "--cuisine" && next) {
      options.cuisine = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      options.limit = capLeadLimit(Number.parseInt(next, 10));
      index += 1;
    } else if ((arg === "--search-mode" || arg === "--mode") && next) {
      options.searchMode = parseSearchMode(next);
      options.exaSearchType = mapSearchModeToExaType(options.searchMode, args.join(" "));
      index += 1;
    } else if (arg === "--send-telegram") {
      options.sendTelegram = true;
    } else if (arg === "--write-json") {
      options.writeJson = true;
    }
  }

  if (!options.location) {
    throw new Error("Missing --location. No default location is used.");
  }
  if (!options.cuisine) {
    throw new Error("Missing --cuisine. No default cuisine/category is used.");
  }
  if (!Number.isFinite(options.limit)) options.limit = DAILY_VALIDATED_LEAD_TARGET;
  if (!options.searchMode || !options.exaSearchType) {
    throw new Error("Missing --search-mode quick|smart|deep. No default Exa search mode is used in the local pipeline.");
  }

  return options;
}

function parseSearchMode(value: string): CliOptions["searchMode"] {
  const normalized = value.toLowerCase();
  if (normalized === "quick" || normalized === "smart" || normalized === "deep") return normalized;
  throw new Error(`Invalid --search-mode ${value}. Use quick, smart, or deep.`);
}

function mapSearchModeToExaType(mode: CliOptions["searchMode"], rawArgs: string): CliOptions["exaSearchType"] {
  if (mode === "quick") return "fast";
  if (mode === "deep" && /\b(deep-reasoning|deep reasoning|very deep|highest reasoning)\b/i.test(rawArgs)) return "deep-reasoning";
  if (mode === "deep") return "deep";
  return "auto";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
