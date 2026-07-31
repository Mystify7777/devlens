import type { DevLensEvent } from "@devlens/core";

export interface Inspector {
  readonly element: HTMLElement;
  render(event: DevLensEvent | null): void;
}

function renderEmptyState(root: HTMLElement): void {
  root.replaceChildren();
  root.setAttribute("data-devlens-inspector-state", "empty");

  const message = document.createElement("p");
  message.setAttribute("data-devlens-inspector-empty", "");
  message.textContent =
    "Select an event to inspect it. Details, stack traces, metadata, and context will appear here.";

  root.appendChild(message);
}

// Sections are rendered in reading order:
//
//   message
//   stack
//   metadata
//   context
//   tags
//
// Future fields should preserve this progression unless there's a
// compelling UX reason to reorder them — the answer to "where should
// a new field go" is "wherever it belongs in this reading flow," not
// "wherever its source category feels most important."

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    // Circular or otherwise non-serializable; fall back rather than throw.
    return String(value);
  }
}

function createKeyValueSection(
  label: string,
  attribute: string,
  data: Record<string, unknown>
): HTMLElement | null {
  const keys = Object.keys(data);
  if (keys.length === 0) return null;

  const section = document.createElement("section");
  section.setAttribute(attribute, "");

  const heading = document.createElement("h3");
  heading.textContent = label;
  section.appendChild(heading);

  const list = document.createElement("dl");
  for (const key of keys) {
    const dt = document.createElement("dt");
    dt.textContent = key;

    const dd = document.createElement("dd");
    dd.textContent = safeStringify(data[key]);

    list.append(dt, dd);
  }
  section.appendChild(list);

  return section;
}

function createListSection(
  label: string,
  attribute: string,
  items: string[]
): HTMLElement | null {
  if (items.length === 0) return null;

  const section = document.createElement("section");
  section.setAttribute(attribute, "");

  const heading = document.createElement("h3");
  heading.textContent = label;
  section.appendChild(heading);

  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  section.appendChild(list);

  return section;
}

function renderEventDetail(root: HTMLElement, event: DevLensEvent): void {
  root.replaceChildren();
  root.setAttribute("data-devlens-inspector-state", "populated");

  const header = document.createElement("header");
  header.setAttribute("data-devlens-inspector-header", "");

  const severity = document.createElement("span");
  severity.setAttribute("data-devlens-inspector-severity", "");
  severity.textContent = event.severity.toUpperCase();

  const title = document.createElement("h2");
  title.setAttribute("data-devlens-inspector-title", "");
  title.textContent = event.title;

  header.append(severity, title);
  root.appendChild(header);

  const message = document.createElement("p");
  message.setAttribute("data-devlens-inspector-message", "");
  message.textContent = event.message;
  root.appendChild(message);

  // Missing fields disappear entirely rather than rendering an empty
  // or placeholder section — the inspector describes the event that
  // exists, not the maximal event schema.

  if (event.stack) {
    const stackSection = document.createElement("section");
    stackSection.setAttribute("data-devlens-inspector-stack", "");

    const heading = document.createElement("h3");
    heading.textContent = "Stack";
    stackSection.appendChild(heading);

    const pre = document.createElement("pre");
    pre.textContent = event.stack;
    stackSection.appendChild(pre);

    root.appendChild(stackSection);
  }

  if (event.metadata) {
    const section = createKeyValueSection(
      "Metadata",
      "data-devlens-inspector-metadata",
      event.metadata
    );
    if (section) root.appendChild(section);
  }

  if (event.context) {
    const section = createKeyValueSection(
      "Context",
      "data-devlens-inspector-context",
      event.context
    );
    if (section) root.appendChild(section);
  }

  if (event.tags) {
    const section = createListSection(
      "Tags",
      "data-devlens-inspector-tags",
      event.tags
    );
    if (section) root.appendChild(section);
  }
}

export function createInspector(): Inspector {
  const element = document.createElement("div");
  element.setAttribute("data-devlens-inspector", "");

  renderEmptyState(element);

  return {
    element,
    render(event) {
      if (event === null) {
        renderEmptyState(element);
        return;
      }
      renderEventDetail(element, event);
    },
  };
}
