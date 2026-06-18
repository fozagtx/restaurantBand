import { startBandAgents } from "./agents/runAgents.js";
import { runTelegramInputBot } from "./telegramInputBot.js";

type RuntimeTask = {
  name: string;
  stop?: () => Promise<void>;
  promise?: Promise<void>;
};

async function main(): Promise<void> {
  const tasks: RuntimeTask[] = [];
  const runBandAgents = process.env.RAILWAY_RUN_BAND_AGENTS !== "false";
  const runTelegramInput = process.env.RAILWAY_RUN_TELEGRAM_INPUT !== "false";

  if (!runBandAgents && !runTelegramInput) {
    throw new Error("Nothing to run. Set RAILWAY_RUN_BAND_AGENTS or RAILWAY_RUN_TELEGRAM_INPUT to true.");
  }

  if (runBandAgents) {
    const bandAgents = await startBandAgents();
    tasks.push({ name: "Band agents", stop: bandAgents.stop });
  }

  if (runTelegramInput) {
    const controller = new AbortController();
    const promise = runTelegramInputBot({ signal: controller.signal });
    tasks.push({
      name: "Telegram input",
      stop: async () => controller.abort(),
      promise
    });
  }

  console.log(`Railway worker started: ${tasks.map((task) => task.name).join(", ")}`);

  const shutdown = async (): Promise<void> => {
    console.log("Railway worker shutting down.");
    await Promise.all(tasks.map((task) => task.stop?.()));
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const watched = tasks.map((task) => task.promise).filter((promise): promise is Promise<void> => Boolean(promise));
  if (watched.length) {
    await Promise.race(watched);
  } else {
    await new Promise(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
