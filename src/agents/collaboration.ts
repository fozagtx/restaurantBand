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
  await ensureParticipant(tools, mention, role);
  const compactPayload = compactHandoffPayload(payload);
  const handoffType = getPayloadType(compactPayload);
  const content = `${intro} Next: ${mention}.`;
  await callToolOrSdk(
    tools,
    "send_event_service",
    "thenvoi_send_event",
    {
      content,
      message_type: "task",
      metadata: {
        handoff_type: handoffType,
        handoff_payload_json: JSON.stringify(compactPayload),
        target_mention: mention
      }
    }
  );
}

export async function reportProgress(tools: AdapterToolsProtocol, message: string): Promise<void> {
  try {
    await tools.sendMessage(message);
  } catch {
    await optionalCall(() => tools.sendEvent(message, "task", { kind: "agent_progress", message }), undefined);
  }
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

function compactHandoffPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as UnknownRecord;
  return {
    ...record,
    collaborationLog: compactArray(record.collaborationLog, 2),
    leads: Array.isArray(record.leads) ? record.leads.map(compactLead) : record.leads,
    research: record.research && typeof record.research === "object" ? compactHandoffPayload(record.research) : record.research,
    copyPackage: record.copyPackage && typeof record.copyPackage === "object" ? compactHandoffPayload(record.copyPackage) : record.copyPackage
  };
}

function compactLead(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const lead = value as UnknownRecord;
  return {
    ...lead,
    imageUrls: compactArray(lead.imageUrls, 4),
    sourceUrls: compactArray(lead.sourceUrls, 6),
    menuUrls: compactArray(lead.menuUrls, 4),
    socialUrls: compactArray(lead.socialUrls, 3),
    contactPeople: Array.isArray(lead.contactPeople)
      ? lead.contactPeople.map((person) => {
          if (!person || typeof person !== "object") return person;
          const record = person as UnknownRecord;
          return { ...record, evidence: truncateText(record.evidence, 180) };
        })
      : lead.contactPeople,
    evidence: Array.isArray(lead.evidence)
      ? lead.evidence.slice(0, 3).map((item) => {
          if (!item || typeof item !== "object") return item;
          const record = item as UnknownRecord;
          return {
            title: record.title,
            url: record.url,
            highlights: compactArray(record.highlights, 1).map((highlight) => truncateText(highlight, 180)),
            textExcerpt: truncateText(record.textExcerpt, 220),
            ...(typeof record.imageUrl === "string" ? { imageUrl: record.imageUrl } : {})
          };
        })
      : lead.evidence
  };
}

function compactArray(value: unknown, limit: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function truncateText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function getPayloadType(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as UnknownRecord).type;
  return typeof value === "string" ? value : "";
}

async function optionalCall<T>(fn: () => Promise<T>, valueIfUnavailable: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return valueIfUnavailable;
  }
}
