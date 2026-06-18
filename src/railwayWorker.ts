import { startBandAgents } from "./agents/runAgents.js";

async function main(): Promise<void> {
  const bandAgents = await startBandAgents();
  console.log("Railway worker started: Band agents. Telegram is output-only.");

  const shutdown = async (): Promise<void> => {
    console.log("Railway worker shutting down.");
    await bandAgents.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
