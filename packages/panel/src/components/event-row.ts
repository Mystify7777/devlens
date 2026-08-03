import type { DevLensEvent } from "@devlens/core";
import { highlightText } from "../highlight";

/**
 * Renders a single row in the event list. Deliberately minimal: one
 * DOM element per event, built fresh each call — renderer.ts owns
 * deciding *when* to rebuild the list (Store changes) versus *not*
 * rebuild it (selection changes), not this function; createEventRow()
 * has no opinion about that and is safe to call as often as needed.
 *
 * Two different severity-related attributes exist for two different
 * purposes, not by accident:
 * - `data-devlens-severity` (on the row itself) carries the raw,
 *   lowercase severity value as a CSS styling hook — e.g. a future
 *   `[data-devlens-severity="error"] { ... }` rule in styles.ts.
 * - `data-devlens-event-severity` (on the inner span) identifies the
 *   severity *text* element for tests/DOM queries, independent of
 *   whatever value it displays.
 *
 * `data-devlens-event-id` is what makes delegated click handling
 * possible — panel.ts resolves a click back to a real event via this
 * attribute rather than a per-row callback or a parallel WeakMap.
 *
 * `searchQuery` highlights matches in title/message only — the two
 * fields this row renders as text. Per the Search presentation
 * model's highlight-scope decision (docs/specs/inspection.md), a row
 * never highlights fields it doesn't display (e.g. stack); that's not
 * a limitation to work around, it's what "highlight what's rendered"
 * means. An empty query renders plain text, identical to before
 * highlighting existed.
 */
export function createEventRow(
  event: DevLensEvent,
  searchQuery: string
): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-devlens-event-row", "");
  row.setAttribute("data-devlens-event-id", event.id);
  row.setAttribute("data-devlens-severity", event.severity);

  const severity = document.createElement("span");
  severity.setAttribute("data-devlens-event-severity", "");
  severity.textContent = event.severity.toUpperCase();

  const title = document.createElement("span");
  title.setAttribute("data-devlens-event-title", "");
  title.appendChild(highlightText(event.title, searchQuery));

  const message = document.createElement("span");
  message.setAttribute("data-devlens-event-message", "");
  message.appendChild(highlightText(event.message, searchQuery));

  row.append(severity, title, message);

  return row;
}