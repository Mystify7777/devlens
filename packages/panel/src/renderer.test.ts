// packages/panel/src/renderer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { createRenderer } from "./renderer";

// NOTE:
//
// Renderer currently owns the entire ShadowRoot (per ADR-0008: the
// container/ShadowRoot split into a dedicated eventListContainer is a
// deliberately deferred Session 3+ consideration). Once the Panel gains
// header/toolbar/list structure and the renderer is narrowed to take
// only the event-list sub-element, add a regression test here ensuring
// unrelated siblings (style, header, footer) survive render() calls.

let idCounter = 0;

function makeEvent(overrides: Partial<DevLensEvent> = {}): DevLensEvent {
  idCounter += 1;
  return {
    id: `event-${idCounter}`,
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

function createShadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  return host.attachShadow({ mode: "open" });
}

describe("createRenderer", () => {
  let container: ShadowRoot;

  beforeEach(() => {
    idCounter = 0;
    container = createShadowRoot();
  });

  it("renders one row per event", () => {
    const renderer = createRenderer(container);
    const events = [makeEvent(), makeEvent(), makeEvent()];

    renderer.render(events);

    expect(
      container.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(3);
  });

  it("clears previous event rows before rendering", () => {
    const renderer = createRenderer(container);

    renderer.render([makeEvent({ title: "First" })]);
    renderer.render([makeEvent({ title: "Second" })]);

    const rows = container.querySelectorAll("[data-devlens-event-row]");
    expect(rows).toHaveLength(1);
    expect(
      container.querySelector("[data-devlens-event-title]")?.textContent
    ).toBe("Second");
  });

  it("removes existing rows when rendered with an empty array", () => {
    const renderer = createRenderer(container);

    renderer.render([makeEvent(), makeEvent()]);
    renderer.render([]);

    expect(
      container.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(0);
  });

  it("renders events in input order", () => {
    const renderer = createRenderer(container);
    const events = [
      makeEvent({ title: "Alpha" }),
      makeEvent({ title: "Beta" }),
      makeEvent({ title: "Gamma" }),
    ];

    renderer.render(events);

    const titles = Array.from(
      container.querySelectorAll("[data-devlens-event-title]")
    ).map((el) => el.textContent);

    expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not duplicate rows when render() is called twice with the same events", () => {
    const renderer = createRenderer(container);
    const events = [makeEvent(), makeEvent()];

    renderer.render(events);
    renderer.render(events);

    expect(
      container.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(2);
  });
});