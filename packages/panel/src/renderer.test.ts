// packages/panel/src/renderer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { createRenderer } from "./renderer";

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

  it("mounts an event-list region and an inspector region on creation", () => {
    createRenderer(container);

    expect(
      container.querySelector("[data-devlens-event-list]")
    ).not.toBeNull();
    expect(container.querySelector("[data-devlens-inspector]")).not.toBeNull();
  });

  it("renders the inspector's empty state immediately on creation", () => {
    createRenderer(container);

    expect(
      container.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();
  });

  describe("renderEventList", () => {
    it("renders one row per event", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent(), makeEvent()];

      renderer.renderEventList(events);

      expect(
        container.querySelectorAll("[data-devlens-event-row]")
      ).toHaveLength(3);
    });

    it("clears previous event rows before rendering", () => {
      const renderer = createRenderer(container);

      renderer.renderEventList([makeEvent({ title: "First" })]);
      renderer.renderEventList([makeEvent({ title: "Second" })]);

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows).toHaveLength(1);
      expect(
        container.querySelector("[data-devlens-event-title]")?.textContent
      ).toBe("Second");
    });

    it("removes existing rows when rendered with an empty array", () => {
      const renderer = createRenderer(container);

      renderer.renderEventList([makeEvent(), makeEvent()]);
      renderer.renderEventList([]);

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

      renderer.renderEventList(events);

      const titles = Array.from(
        container.querySelectorAll("[data-devlens-event-title]")
      ).map((el) => el.textContent);

      expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("does not duplicate rows when called twice with the same events", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];

      renderer.renderEventList(events);
      renderer.renderEventList(events);

      expect(
        container.querySelectorAll("[data-devlens-event-row]")
      ).toHaveLength(2);
    });

    it("preserves the inspector region when the event list re-renders", () => {
      // This is the regression test deferred in an earlier revision of
      // this file, back when the renderer owned the whole ShadowRoot
      // as one flat container. Now that renderEventList only touches
      // [data-devlens-event-list], the inspector (and, if styles.ts
      // ever injects a <style> tag directly into the ShadowRoot,
      // that too) survives event-list re-renders untouched.
      const renderer = createRenderer(container);
      const inspectorNode = container.querySelector("[data-devlens-inspector]");

      renderer.renderEventList([makeEvent()]);
      renderer.renderEventList([makeEvent(), makeEvent()]);

      expect(container.querySelector("[data-devlens-inspector]")).toBe(
        inspectorNode
      );
    });
  });

  describe("renderInspector", () => {
    it("renders event detail into the inspector region", () => {
      const renderer = createRenderer(container);

      renderer.renderInspector(makeEvent({ title: "Selected Event" }));

      expect(
        container.querySelector("[data-devlens-inspector-title]")?.textContent
      ).toBe("Selected Event");
    });

    it("returns the inspector to its empty state when passed null", () => {
      const renderer = createRenderer(container);

      renderer.renderInspector(makeEvent());
      renderer.renderInspector(null);

      expect(
        container.querySelector("[data-devlens-inspector-empty]")
      ).not.toBeNull();
    });

    it("does not affect the event list", () => {
      const renderer = createRenderer(container);

      renderer.renderEventList([makeEvent({ title: "Row Event" })]);
      renderer.renderInspector(makeEvent({ title: "Different Selected Event" }));

      expect(
        container.querySelector("[data-devlens-event-title]")?.textContent
      ).toBe("Row Event");
    });
  });

  describe("setSelectedRow", () => {
    it("adds data-selected to the matching row", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];
      renderer.renderEventList(events);

      renderer.setSelectedRow(events[1].id);

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows[0].hasAttribute("data-selected")).toBe(false);
      expect(rows[1].hasAttribute("data-selected")).toBe(true);
    });

    it("moves the selection when called again with a different id", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];
      renderer.renderEventList(events);

      renderer.setSelectedRow(events[0].id);
      renderer.setSelectedRow(events[1].id);

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows[0].hasAttribute("data-selected")).toBe(false);
      expect(rows[1].hasAttribute("data-selected")).toBe(true);
    });

    it("clears the selection when called with null", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent()];
      renderer.renderEventList(events);

      renderer.setSelectedRow(events[0].id);
      renderer.setSelectedRow(null);

      expect(
        container.querySelector("[data-devlens-event-row]")?.hasAttribute(
          "data-selected"
        )
      ).toBe(false);
    });

    it("does nothing (no throw) when the id has no matching row", () => {
      const renderer = createRenderer(container);
      renderer.renderEventList([makeEvent()]);

      expect(() => renderer.setSelectedRow("no-such-id")).not.toThrow();
    });

    it("clears the highlight after the event list re-renders, even if the id is still present", () => {
      // renderEventList() rebuilds row elements from scratch, so a
      // previously-applied highlight doesn't survive on the new DOM
      // nodes unless setSelectedRow() is called again. This documents
      // that panel.ts is responsible for re-asserting selection after
      // every list rebuild, not an accident of stale references.
      const renderer = createRenderer(container);
      const event = makeEvent();
      renderer.renderEventList([event]);
      renderer.setSelectedRow(event.id);

      renderer.renderEventList([event]);

      expect(
        container.querySelector("[data-devlens-event-row]")?.hasAttribute(
          "data-selected"
        )
      ).toBe(false);
    });
  });
});
