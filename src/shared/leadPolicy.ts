export const DAILY_VALIDATED_LEAD_TARGET = 2;

export function capLeadLimit(limit: number): number {
  if (!Number.isFinite(limit)) throw new Error("Lead limit must be finite.");
  if (limit < 1) throw new Error("Lead limit must be at least 1.");
  return Math.min(DAILY_VALIDATED_LEAD_TARGET, Math.round(limit));
}

export function requestedLimitNote(requestedLimit: number): string | null {
  if (!Number.isFinite(requestedLimit) || requestedLimit <= DAILY_VALIDATED_LEAD_TARGET) return null;
  return `Requested ${Math.round(requestedLimit)} leads, but this workflow is capped at ${DAILY_VALIDATED_LEAD_TARGET} validated leads so the full copy/design delivery can finish.`;
}
