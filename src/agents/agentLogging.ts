import type { AdapterToolsProtocol, PlatformMessage } from "@band-ai/sdk";

const processStartedAt = Date.now();

export async function runLoggedAgent(
  agentName: string,
  message: PlatformMessage,
  tools: AdapterToolsProtocol,
  handler: () => Promise<void>
): Promise<void> {
  const preview = message.content.replace(/\s+/g, " ").slice(0, 180);
  if (isStaleStartupMessage(message)) {
    console.log(`[${agentName}] ignored stale startup message ${message.id}: ${preview}`);
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

function isStaleStartupMessage(message: PlatformMessage): boolean {
  const createdAt = message.createdAt instanceof Date ? message.createdAt.getTime() : new Date(message.createdAt).getTime();
  return Number.isFinite(createdAt) && createdAt < processStartedAt - 5_000;
}
