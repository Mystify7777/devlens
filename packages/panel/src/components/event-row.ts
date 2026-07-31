import type { DevLensEvent } from "@devlens/core";

export function createEventRow(event: DevLensEvent): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-devlens-event-row", "");
  row.setAttribute("data-devlens-event-id", event.id);
  row.setAttribute("data-devlens-severity", event.severity);

  const severity = document.createElement("span");
  severity.setAttribute("data-devlens-event-severity", "");
  severity.textContent = event.severity.toUpperCase();

  const title = document.createElement("span");
  title.setAttribute("data-devlens-event-title", "");
  title.textContent = event.title;

  const message = document.createElement("span");
  message.setAttribute("data-devlens-event-message", "");
  message.textContent = event.message;

  row.append(severity, title, message);

  return row;
}