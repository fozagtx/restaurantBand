import type { AdapterToolsProtocol, PlatformMessage } from "@band-ai/sdk";

const processStartedAt = Date.now();
const startupReplayWindowMs = parseStartupReplayWindowMs();
const processedStartupReplayKeys = new Set<string>();

export async function runLoggedAgent(
  agentName: string,
  message: PlatformMessage,
  tools: AdapterToolsProtocol,
  handler: () => Promise<void>
): Promise<void> {
  const preview = message.content.replace(/\s+/g, " ").slice(0, 180);
  const startupReplay = getStartupReplayState(message);
  if (startupReplay === "old") {
    console.log(`[${agentName}] ignored old startup replay ${message.id}: ${preview}`);
    return;
  }
  if (startupReplay === "duplicate") {
    console.log(`[${agentName}] ignored duplicate startup replay ${message.id}: ${preview}`);
    return;
  }
  console.log(`[${agentName}] received message ${message.id} in room ${message.roomId}: ${preview}`);
  try {
    await handler();
    console.log(`[${agentName}] completed message ${message.id}`);
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[${agentName}] failed message ${message.id}:`, error);
    try {
      await tools.sendMessage(`${agentName} failed: ${text}`, [{ id: message.senderId }]);
    } catch (sendError) {
      console.error(`[${agentName}] also failed to report error to Band:`, sendError);
    }
    throw error;
  }
}

function getStartupReplayState(message: PlatformMessage): "current" | "recent" | "duplicate" | "old" {
  const createdAt = message.createdAt instanceof Date ? message.createdAt.getTime() : new Date(message.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return "current";
  if (createdAt >= processStartedAt - 5_000) return "current";
  if (createdAt < processStartedAt - startupReplayWindowMs) return "old";

  const key = [
    message.roomId,
    message.senderId,
    Math.floor(createdAt / 60_000),
    message.content.replace(/\s+/g, " ").trim().toLowerCase()
  ].join("|");
  if (processedStartupReplayKeys.has(key)) return "duplicate";
  processedStartupReplayKeys.add(key);
  return "recent";
}

function parseStartupReplayWindowMs(): number {
  const value = process.env.BAND_STARTUP_REPLAY_WINDOW_MINUTES;
  if (!value) return 30 * 60_000;
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) return 30 * 60_000;
  return minutes * 60_000;
}
