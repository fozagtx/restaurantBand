import type { AdapterToolsProtocol } from "@band-ai/sdk";

type UnknownRecord = Record<string, unknown>;
type ToolUseLog = {
  uiService: string;
  sdkTool: string;
};

export async function ensureParticipant(
  tools: AdapterToolsProtocol,
  mention: string,
  role: string
): Promise<{ added: boolean; participantName: string; toolLog: ToolUseLog[] }> {
  const toolLog: ToolUseLog[] = [];
  const targetName = normalizeMention(mention);
  const participantsResult = await callToolOrSdk(
    tools,
    "list_chat_participants_service",
    "thenvoi_get_participants",
    {}
  );
  toolLog.push(participantsResult.log);
  const participants = normalizeList(participantsResult.value);
  if (participants.some((participant) => participantMatches(participant as unknown as UnknownRecord, targetName))) {
    return { added: false, participantName: targetName, toolLog };
  }

  const peerResult = await findAvailablePeerName(tools, targetName);
  toolLog.push(...peerResult.toolLog);
  const peerName = peerResult.peerName ?? targetName;
  const addResult = await callToolOrSdk(
    tools,
    "add_participant_service",
    "thenvoi_add_participant",
    { name: peerName, role }
  );
  toolLog.push(addResult.log);
  return { added: true, participantName: peerName, toolLog };
}

export async function sendHandoff(
  tools: AdapterToolsProtocol,
  mention: string,
  role: string,
  intro: string,
  payload: unknown
): Promise<void> {
  const participantResult = await ensureParticipant(tools, mention, role);
  const content = `${mention} ${intro}\n\nBand tool usage for this handoff:\n${formatToolLog(participantResult.toolLog)}\n- send_direct_message_service -> thenvoi_send_message\n\n${JSON.stringify(payload, null, 2)}`;
  await callToolOrSdk(
    tools,
    "send_direct_message_service",
    "thenvoi_send_message",
    { content, mentions: [mention] }
  );
}

export async function reportProgress(tools: AdapterToolsProtocol, message: string): Promise<void> {
  await optionalCall(() => tools.sendEvent(message, "agent_progress", { message }), undefined);
}

async function findAvailablePeerName(tools: AdapterToolsProtocol, targetName: string): Promise<{ peerName: string | null; toolLog: ToolUseLog[] }> {
  const toolLog: ToolUseLog[] = [];
  if (!tools.lookupPeers) return { peerName: null, toolLog };
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const lookupResult = await callToolOrSdk(
      tools,
      "list_available_participants_service",
      "thenvoi_lookup_peers",
      { page, page_size: 50 }
    );
    toolLog.push(lookupResult.log);
    const result = lookupResult.value;
    const records = extractRecords(result as unknown as UnknownRecord);
    const match = records.find((record) => participantMatches(record, targetName));
    if (match) return { peerName: getRecordName(match) ?? targetName, toolLog };
    totalPages = getTotalPages(result as unknown as UnknownRecord) ?? totalPages;
    page += 1;
  }
  return { peerName: null, toolLog };
}

export async function tryContextService(
  tools: AdapterToolsProtocol,
  uiService: "geocode_location_service" | "weather_forecast_service",
  args: UnknownRecord
): Promise<{ ok: boolean; service: string; result?: unknown; error?: string }> {
  const result = await tools.executeToolCall(uiService, args);
  if (isToolError(result)) {
    return { ok: false, service: uiService, error: extractToolError(result) };
  }
  return { ok: true, service: uiService, result };
}

function formatToolLog(log: ToolUseLog[]): string {
  return log.map((item) => `- ${item.uiService} -> ${item.sdkTool}`).join("\n");
}

async function callToolOrSdk<T>(
  tools: AdapterToolsProtocol,
  uiService: string,
  sdkTool: string,
  args: UnknownRecord
): Promise<{ value: T; log: ToolUseLog }> {
  const direct = await tools.executeToolCall(sdkTool, args);
  if (isToolError(direct)) {
    throw new Error(`${uiService} / ${sdkTool} failed: ${extractToolError(direct)}`);
  }
  return { value: direct as T, log: { uiService, sdkTool } };
}

function isToolError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as UnknownRecord;
  return typeof record.errorType === "string" || typeof record.error_type === "string" || record.ok === false;
}

function extractToolError(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const record = value as UnknownRecord;
  return String(record.message ?? record.error ?? record.errorType ?? record.error_type ?? JSON.stringify(value));
}

function normalizeList(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
  if (value && typeof value === "object") return extractRecords(value as UnknownRecord);
  return [];
}

function extractRecords(result: UnknownRecord): UnknownRecord[] {
  const candidates = [result.items, result.records, result.results, result.data, result.peers];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
  }
  return [];
}

function getTotalPages(result: UnknownRecord): number | null {
  for (const key of ["total_pages", "totalPages", "pages"]) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function participantMatches(record: UnknownRecord, targetName: string): boolean {
  const target = targetName.toLowerCase();
  const values = [
    record.name,
    record.displayName,
    record.display_name,
    record.username,
    record.handle,
    record.title
  ].filter((value): value is string => typeof value === "string");
  return values.some((value) => normalizeMention(value).toLowerCase() === target);
}

function getRecordName(record: UnknownRecord): string | null {
  for (const key of ["name", "displayName", "display_name", "username", "handle"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return normalizeMention(value);
  }
  return null;
}

function normalizeMention(value: string): string {
  return value.replace(/^@+/, "").trim();
}

async function optionalCall<T>(fn: () => Promise<T>, valueIfUnavailable: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return valueIfUnavailable;
  }
}
