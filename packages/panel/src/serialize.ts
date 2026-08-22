import type { DevLensEvent } from "@devlens/core";

/**
 * Serializes a DevLensEvent array to a pretty-printed JSON string.
 *
 * Pure leaf — deterministic, side-effect-free, no dependency on Panel,
 * the Store, or any rendering layer. Operates on whatever array it's
 * given; callers are responsible for providing the right set (panel.ts
 * passes store.getAll(), not currentVisibleEvents — see
 * docs/specs/inspection.md, "Pause/Resume/Clear/Export model," decision 5).
 *
 * Deliberately minimal: no metadata, no schema version, no wrapper
 * object, no filtering, no sorting, no transformation. The correct
 * output for an empty array is "[]". The correct output for a
 * non-empty array is exactly JSON.stringify(events, null, 2).
 *
 * This exact minimal shape — a raw DevLensEvent[] with no wrapper — is
 * also importSession()'s expected input (see ./import.ts and
 * docs/adr/0011-session-import.md). The two functions form a round-trip
 * pair: serializeEvents(store.getAll()) fed back into
 * importSession(json, freshStore) reproduces the original events exactly,
 * including id/timestamp, into an empty Store. serialize.ts has no
 * dependency on import.ts, or vice versa — the pairing is a documented
 * contract between two independent pure functions, not a code coupling.
 */
export function serializeEvents(events: DevLensEvent[]): string {
  return JSON.stringify(events, null, 2);
}
