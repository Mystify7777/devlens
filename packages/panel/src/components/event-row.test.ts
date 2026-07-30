// packages/panel/src/components/event-row.test.ts
import { describe, it, expect } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { createEventRow } from "./event-row";

function makeEvent(overrides: Partial<DevLensEvent> = {}): DevLensEvent {
  return {
    id: "test-id",
    version: 1,
    origin: "console.log",
    category: "console",
    severity: "info",
    title: "Console Log",
    message: "a plain console.log",
    timestamp: 0,
    ...overrides,
  } satisfies DevLensEvent;
}

describe("createEventRow", () => {
  it("creates an HTMLElement", () => {
    const row = createEventRow(makeEvent());
    expect(row).toBeInstanceOf(HTMLElement);
  });

  it("sets the data-devlens-event-row attribute", () => {
    const row = createEventRow(makeEvent());
    expect(row.hasAttribute("data-devlens-event-row")).toBe(true);
  });

  it("sets data-devlens-severity to the event's severity", () => {
    const row = createEventRow(makeEvent({ severity: "warn" }));
    expect(row.getAttribute("data-devlens-severity")).toBe("warn");
  });

  it("renders a severity child with uppercased text", () => {
    const row = createEventRow(makeEvent({ severity: "error" }));
    const severityEl = row.querySelector("[data-devlens-event-severity]");
    expect(severityEl).not.toBeNull();
    expect(severityEl?.textContent).toBe("ERROR");
  });

  it("renders a title child with the event's title", () => {
    const row = createEventRow(makeEvent({ title: "Uncaught Error" }));
    const titleEl = row.querySelector("[data-devlens-event-title]");
    expect(titleEl?.textContent).toBe("Uncaught Error");
  });

  it("renders a message child with the event's message", () => {
    const row = createEventRow(
      makeEvent({ message: "something went wrong" })
    );
    const messageEl = row.querySelector("[data-devlens-event-message]");
    expect(messageEl?.textContent).toBe("something went wrong");
  });

  it("uses textContent, never innerHTML, so markup in message is not parsed", () => {
    const row = createEventRow(
      makeEvent({ message: "<img src=x onerror=alert(1)>" })
    );
    const messageEl = row.querySelector("[data-devlens-event-message]");
    expect(messageEl?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(messageEl?.querySelector("img")).toBeNull();
  });

  it("renders the severity, title, and message elements", () => {
    const row = createEventRow(makeEvent());
    const semanticElements = row.querySelectorAll(
      "[data-devlens-event-severity], [data-devlens-event-title], [data-devlens-event-message]"
    );
    expect(semanticElements).toHaveLength(3);
  });
});