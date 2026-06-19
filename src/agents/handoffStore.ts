import type { z } from "zod";

type StoredHandoff = {
  type: string;
  payload: unknown;
  createdAt: number;
};

const handoffs = new Map<string, StoredHandoff>();
const ttlMs = 30 * 60_000;

export function saveHandoffPayload(type: string, payload: unknown): string {
  pruneExpiredHandoffs();
  const id = `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  handoffs.set(id, { type, payload, createdAt: Date.now() });
  return id;
}

export function hasHandoffPayloadType(text: string, type: string, metadata?: Record<string, unknown>): boolean {
  void metadata;
  return getStoredHandoff(text, type) !== null;
}

export function parseHandoffPayload<T>(text: string, schema: z.ZodType<T>, metadata?: Record<string, unknown>): T {
  void metadata;
  const stored = getStoredHandoff(text);
  if (stored) {
    const result = schema.safeParse(stored.payload);
    if (result.success) return result.data;
  }
  const id = extractHandoffId(text);
  throw new Error(id ? `Handoff ${id} is missing or expired in this worker process.` : "Message lacked a valid Restaura handoff.");
}

export function isRestauraHandoffMessage(text: string): boolean {
  return extractHandoffId(text) !== null || /\bRestaura handoff\b/i.test(text);
}

function getStoredHandoff(text: string, expectedType?: string): StoredHandoff | null {
  pruneExpiredHandoffs();
  const id = extractHandoffId(text);
  if (!id) return null;
  const stored = handoffs.get(id);
  if (!stored) return null;
  if (expectedType && stored.type !== expectedType) return null;
  return stored;
}

function extractHandoffId(text: string): string | null {
  const match = text.match(/\bRestaura handoff\s+(rh-[a-z0-9-]+)/i) ?? text.match(/\bhandoff\s+(rh-[a-z0-9-]+)/i);
  return match?.[1] ?? null;
}

function pruneExpiredHandoffs(): void {
  const cutoff = Date.now() - ttlMs;
  for (const [id, handoff] of handoffs) {
    if (handoff.createdAt < cutoff) handoffs.delete(id);
  }
}
