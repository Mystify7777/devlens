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
 */
export function serializeEvents(events: DevLensEvent[]): string {
  return JSON.stringify(events, null, 2);
}
