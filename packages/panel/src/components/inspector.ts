import type { DevLensEvent } from "@devlens/core";

/**
 * The Inspector is the persistent side-panel detail view described in
 * docs/specs/inspection.md's "Presentation model" decision. It is
 * always mounted (never opened/closed) and renders an explicit empty
 * state whenever nothing is selected.
 *
 * It has zero opinion about *how* selection happens or *when* it
 * changes — that's Panel's job (via selectEvent()) and Renderer's job
 * (renderInspector() is one of three independent capabilities). The
 * Inspector only answers "given this event, or none, what should the
 * detail view show?"
 *
 * Rendering is generic key-value rendering, not per-category
 * templates: severity/title/message/stack/tags are the fields every
 * DevLensEvent can have, and metadata/context are rendered as plain
 * key-value lists with no hardcoded knowledge of what a Runtime,
 * Console, or (future) Network event's metadata looks like. This is
 * deliberate — it's the reason a future Network event needs zero
 * Inspector changes to render sensibly.
 *
 * Missing or empty fields are omitted entirely rather than shown as
 * placeholders ("stack: —" etc.) — an event with no stack simply has
 * no stack section.
 *
 * Every value is written via textContent, never innerHTML. Event
 * data (message, stack, metadata values) originates from the host
 * app and must never be interpreted as markup.
 */
export interface Inspector {
  readonly element: HTMLElement;
  render(event: DevLensEvent | null): void;
}

export function createInspector(): Inspector {
  const element = document.createElement("div");
  element.setAttribute("data-devlens-inspector", "");

  function renderEmptyState() {
    element.replaceChildren();

    const empty = document.createElement("div");
    empty.setAttribute("data-devlens-inspector-empty", "");
    empty.textContent = "No event selected.";
    element.appendChild(empty);
  }

  function appendField(name: string, value: string) {
    const field = document.createElement("div");
    field.setAttribute(`data-devlens-inspector-${name}`, "");
    field.textContent = value;
    element.appendChild(field);
  }

  function appendKeyValueSection(
    name: string,
    record: Record<string, unknown> | undefined
  ) {
    if (!record) return;

    const entries = Object.entries(record);
    if (entries.length === 0) return;

    const section = document.createElement("div");
    section.setAttribute(`data-devlens-inspector-${name}`, "");

    for (const [key, value] of entries) {
      const row = document.createElement("div");
      row.setAttribute(`data-devlens-inspector-${name}-entry`, "");

      const keyEl = document.createElement("span");
      keyEl.setAttribute(`data-devlens-inspector-${name}-key`, "");
      keyEl.textContent = key;

      const valueEl = document.createElement("span");
      valueEl.setAttribute(`data-devlens-inspector-${name}-value`, "");
      valueEl.textContent = stringifyValue(value);

      row.append(keyEl, valueEl);
      section.appendChild(row);
    }

    element.appendChild(section);
  }

  function stringifyValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function appendTags(tags: string[] | undefined) {
    if (!tags || tags.length === 0) return;

    const section = document.createElement("div");
    section.setAttribute("data-devlens-inspector-tags", "");

    for (const tag of tags) {
      const tagEl = document.createElement("span");
      tagEl.setAttribute("data-devlens-inspector-tag", "");
      tagEl.textContent = tag;
      section.appendChild(tagEl);
    }

    element.appendChild(section);
  }

  function render(event: DevLensEvent | null) {
    if (event === null) {
      renderEmptyState();
      return;
    }

    element.replaceChildren();

    appendField("severity", event.severity.toUpperCase());
    appendField("title", event.title);
    appendField("message", event.message);

    if (event.stack) {
      appendField("stack", event.stack);
    }

    appendKeyValueSection("metadata", event.metadata);
    appendKeyValueSection("context", event.context);
    appendTags(event.tags);
  }

  renderEmptyState();

  return { element, render };
}
