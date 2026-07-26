/**
 * Generates a unique ID for a DevLensEvent.
 *
 * Isolated in its own module so the ID strategy (UUID v4, UUID v7, ULID,
 * Snowflake, etc.) can change later without touching the Event Bus.
 */
export function generateEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}