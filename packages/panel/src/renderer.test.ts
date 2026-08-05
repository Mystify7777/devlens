// packages/panel/src/renderer.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DevLensEvent } from "@devlens/core";
import { createRenderer, type EventListRenderInfo } from "./renderer";

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

/**
 * Builds an EventListRenderInfo for the common case — no divergence
 * between Navigation Context and Store, so neither empty state nor
 * the count fires. Tests targeting those states override the relevant
 * counts explicitly.
 */
function listInfo(
  visibleEvents: DevLensEvent[],
  overrides: Partial<EventListRenderInfo> = {}
): EventListRenderInfo {
  return {
    visibleEvents,
    searchQuery: "",
    navigationContextCount: visibleEvents.length,
    totalStoreCount: visibleEvents.length,
    ...overrides,
  };
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

      renderer.renderEventList(listInfo(events));

      expect(
        container.querySelectorAll("[data-devlens-event-row]")
      ).toHaveLength(3);
    });

    it("clears previous event rows before rendering", () => {
      const renderer = createRenderer(container);

      renderer.renderEventList(listInfo([makeEvent({ title: "First" })]));
      renderer.renderEventList(listInfo([makeEvent({ title: "Second" })]));

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows).toHaveLength(1);
      expect(
        container.querySelector("[data-devlens-event-title]")?.textContent
      ).toBe("Second");
    });

    it("renders events in input order", () => {
      const renderer = createRenderer(container);
      const events = [
        makeEvent({ title: "Alpha" }),
        makeEvent({ title: "Beta" }),
        makeEvent({ title: "Gamma" }),
      ];

      renderer.renderEventList(listInfo(events));

      const titles = Array.from(
        container.querySelectorAll("[data-devlens-event-title]")
      ).map((el) => el.textContent);

      expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("does not duplicate rows when called twice with the same events", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];

      renderer.renderEventList(listInfo(events));
      renderer.renderEventList(listInfo(events));

      expect(
        container.querySelectorAll("[data-devlens-event-row]")
      ).toHaveLength(2);
    });

    it("preserves the inspector region when the event list re-renders", () => {
      // This is the regression test deferred in an earlier revision of
      // this file, back when the renderer owned the whole ShadowRoot
      // as one flat container. Now that renderEventList only touches
      // [data-devlens-event-list], the inspector (and the injected
      // <style> tag) survives event-list re-renders untouched.
      const renderer = createRenderer(container);
      const inspectorNode = container.querySelector("[data-devlens-inspector]");

      renderer.renderEventList(listInfo([makeEvent()]));
      renderer.renderEventList(listInfo([makeEvent(), makeEvent()]));

      expect(container.querySelector("[data-devlens-inspector]")).toBe(
        inspectorNode
      );
    });

    it("highlights matches in rows using the given searchQuery", () => {
      const renderer = createRenderer(container);
      const event = makeEvent({ title: "Network Timeout" });

      renderer.renderEventList(
        listInfo([event], { searchQuery: "timeout" })
      );

      expect(
        container.querySelector("[data-devlens-match]")?.textContent
      ).toBe("Timeout");
    });

    describe("empty and count states", () => {
      it("shows the Store-empty message when totalStoreCount is 0", () => {
        const renderer = createRenderer(container);

        renderer.renderEventList(
          listInfo([], { totalStoreCount: 0, navigationContextCount: 0 })
        );

        expect(
          container.querySelector('[data-devlens-event-list-empty="store"]')
        ).not.toBeNull();
        expect(
          container.querySelectorAll("[data-devlens-event-row]")
        ).toHaveLength(0);
      });

      it("shows the filtered-empty message when the Store has events but the Navigation Context is empty", () => {
        const renderer = createRenderer(container);

        renderer.renderEventList(
          listInfo([], { totalStoreCount: 5, navigationContextCount: 0 })
        );

        expect(
          container.querySelector(
            '[data-devlens-event-list-empty="filtered"]'
          )
        ).not.toBeNull();
        expect(
          container.querySelectorAll("[data-devlens-event-row]")
        ).toHaveLength(0);
      });

      it("shows neither empty state nor a count when Navigation Context equals the Store", () => {
        const renderer = createRenderer(container);
        const events = [makeEvent(), makeEvent()];

        renderer.renderEventList(
          listInfo(events, {
            navigationContextCount: events.length,
            totalStoreCount: events.length,
          })
        );

        expect(
          container.querySelector("[data-devlens-event-list-empty]")
        ).toBeNull();
        expect(
          container.querySelector("[data-devlens-event-list-count]")
        ).toBeNull();
      });

      it("shows a count only when Navigation Context diverges from the Store", () => {
        const renderer = createRenderer(container);
        const events = [makeEvent(), makeEvent()];

        renderer.renderEventList(
          listInfo(events, { navigationContextCount: 2, totalStoreCount: 340 })
        );

        expect(
          container.querySelector("[data-devlens-event-list-count]")
            ?.textContent
        ).toBe("2 of 340");
      });

      it("does not show a count when the query/filter is set but changes nothing (Navigation Context still equals the Store)", () => {
        const renderer = createRenderer(container);
        const events = [makeEvent(), makeEvent()];

        // Same length on both sides — nothing was actually excluded,
        // even though a caller might have "technically" set a filter
        // that matched everything.
        renderer.renderEventList(
          listInfo(events, {
            searchQuery: "log",
            navigationContextCount: events.length,
            totalStoreCount: events.length,
          })
        );

        expect(
          container.querySelector("[data-devlens-event-list-count]")
        ).toBeNull();
      });

      it("clears an empty state on a subsequent render with matching events", () => {
        const renderer = createRenderer(container);

        renderer.renderEventList(
          listInfo([], { totalStoreCount: 5, navigationContextCount: 0 })
        );
        renderer.renderEventList(listInfo([makeEvent()]));

        expect(
          container.querySelector("[data-devlens-event-list-empty]")
        ).toBeNull();
        expect(
          container.querySelectorAll("[data-devlens-event-row]")
        ).toHaveLength(1);
      });
    });
  });

  describe("renderInspector", () => {
    it("renders event detail into the inspector region", () => {
      const renderer = createRenderer(container);

      renderer.renderInspector(makeEvent({ title: "Selected Event" }), "");

      expect(
        container.querySelector("[data-devlens-inspector-title]")?.textContent
      ).toBe("Selected Event");
    });

    it("returns the inspector to its empty state when passed null", () => {
      const renderer = createRenderer(container);

      renderer.renderInspector(makeEvent(), "");
      renderer.renderInspector(null, "");

      expect(
        container.querySelector("[data-devlens-inspector-empty]")
      ).not.toBeNull();
    });

    it("does not affect the event list", () => {
      const renderer = createRenderer(container);

      renderer.renderEventList(listInfo([makeEvent({ title: "Row Event" })]));
      renderer.renderInspector(
        makeEvent({ title: "Different Selected Event" }),
        ""
      );

      expect(
        container.querySelector("[data-devlens-event-title]")?.textContent
      ).toBe("Row Event");
    });

    it("highlights matches in the inspector using the given searchQuery", () => {
      const renderer = createRenderer(container);

      renderer.renderInspector(
        makeEvent({ title: "Network Timeout" }),
        "timeout"
      );

      expect(
        container.querySelector("[data-devlens-inspector-title] [data-devlens-match]")
          ?.textContent
      ).toBe("Timeout");
    });
  });

  it("makes the event list container focusable, for keyboard navigation to scope to", () => {
    createRenderer(container);

    expect(
      container
        .querySelector("[data-devlens-event-list]")
        ?.getAttribute("tabindex")
    ).toBe("0");
  });

  describe("setSelectedRow", () => {
    it("adds data-selected to the matching row", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];
      renderer.renderEventList(listInfo(events));

      renderer.setSelectedRow(events[1].id);

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows[0].hasAttribute("data-selected")).toBe(false);
      expect(rows[1].hasAttribute("data-selected")).toBe(true);
    });

    it("moves the selection when called again with a different id", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent(), makeEvent()];
      renderer.renderEventList(listInfo(events));

      renderer.setSelectedRow(events[0].id);
      renderer.setSelectedRow(events[1].id);

      const rows = container.querySelectorAll("[data-devlens-event-row]");
      expect(rows[0].hasAttribute("data-selected")).toBe(false);
      expect(rows[1].hasAttribute("data-selected")).toBe(true);
    });

    it("clears the selection when called with null", () => {
      const renderer = createRenderer(container);
      const events = [makeEvent()];
      renderer.renderEventList(listInfo(events));

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
      renderer.renderEventList(listInfo([makeEvent()]));

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
      renderer.renderEventList(listInfo([event]));
      renderer.setSelectedRow(event.id);

      renderer.renderEventList(listInfo([event]));

      expect(
        container.querySelector("[data-devlens-event-row]")?.hasAttribute(
          "data-selected"
        )
      ).toBe(false);
    });

    describe("scrolling the selected row into view", () => {
      it("does not throw when scrollIntoView isn't implemented (e.g. jsdom, by default)", () => {
        const renderer = createRenderer(container);
        const event = makeEvent();
        renderer.renderEventList(listInfo([event]));

        expect(() => renderer.setSelectedRow(event.id)).not.toThrow();
      });

      it("calls scrollIntoView({ block: 'nearest' }) on the selected row when available", () => {
        const scrollIntoView = vi.fn();
        // jsdom doesn't implement scrollIntoView at all; stub it for
        // this test only, restored via vi.restoreAllMocks() below.
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          value: scrollIntoView,
          configurable: true,
          writable: true,
        });

        const renderer = createRenderer(container);
        const events = [makeEvent(), makeEvent()];
        renderer.renderEventList(listInfo(events));

        renderer.setSelectedRow(events[1].id);

        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

        // @ts-expect-error — cleaning up the stub, not part of the type
        delete HTMLElement.prototype.scrollIntoView;
      });

      it("does not scroll when setSelectedRow is called with null", () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          value: scrollIntoView,
          configurable: true,
          writable: true,
        });

        const renderer = createRenderer(container);
        renderer.renderEventList(listInfo([makeEvent()]));

        renderer.setSelectedRow(null);

        expect(scrollIntoView).not.toHaveBeenCalled();

        // @ts-expect-error — cleaning up the stub, not part of the type
        delete HTMLElement.prototype.scrollIntoView;
      });
    });
  });
});
