import type { DevLensEvent } from "@devlens/core";

/**
 * Renders a single DevLensEvent as a DOM node for the event list.
 * TODO(Session 3): actual markup, severity coloring, timestamp formatting.
 */
export function createEventRow(_event: DevLensEvent): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-devlens-event-row", "");
  return row;
}