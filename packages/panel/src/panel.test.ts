// packages/panel/src/panel.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DevLensEvent, EventStore } from "@devlens/core";
import { createPanel } from "./panel";

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
 * Minimal in-memory fake satisfying the documented EventStore shape.
 * Only add/getAll/subscribe are exercised by Panel; the rest are
 * stubbed so this type-checks against the real interface without
 * pulling in @devlens/core's actual store implementation.
 *
 * getSubscriberCount() is a testing-only hook, not part of the real
 * EventStore interface — it exists purely so uninstall() can be
 * proven to actually unsubscribe, rather than merely "not throw."
 *
 * subscribe's handler param is typed as the real EventStore's
 * StoreHandler ((event: DevLensEvent) => void), not a bare () => void.
 * Panel's own subscribe callback ignores the event argument, which is
 * valid — a function type with fewer declared params is assignable
 * wherever more params are expected — but the *fake store itself*
 * must implement the real contract, not the simplified one assumed
 * before this was checked against the actual @devlens/core source.
 */
interface FakeEventStore extends EventStore {
  getSubscriberCount(): number;
}

function createFakeStore(initialEvents: DevLensEvent[] = []): FakeEventStore {
  let events = [...initialEvents];
  const subscribers = new Set<(event: DevLensEvent) => void>();

  function notify(event: DevLensEvent) {
    subscribers.forEach((handler) => handler(event));
  }

  return {
    add(event: DevLensEvent) {
      events = [...events, event];
      notify(event);
    },
    clear() {
      events = [];
    },
    getAll() {
      return events;
    },
    getByCategory(category: string) {
      return events.filter((e) => e.category === category);
    },
    filter(predicate: (event: DevLensEvent) => boolean) {
      return events.filter(predicate);
    },
    subscribe(handler: (event: DevLensEvent) => void) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    destroy() {
      subscribers.clear();
      events = [];
    },
    getSubscriberCount() {
      return subscribers.size;
    },
  };
}

function getPanelRoot(): ShadowRoot | undefined {
  return document.querySelector("[data-devlens-panel-host]")?.shadowRoot ?? undefined;
}

function clickRow(eventId: string): void {
  const row = getPanelRoot()?.querySelector(
    `[data-devlens-event-id="${eventId}"]`
  );
  row?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

describe("createPanel", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("renders existing store contents on install", () => {
    const store = createFakeStore([
      makeEvent({ title: "Existing Event" }),
    ]);
    const panel = createPanel(store);

    panel.install();

    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-title]")?.textContent
    ).toBe("Existing Event");

    panel.uninstall();
  });

  it("renders a new row when the store receives an event after install", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    store.add(makeEvent({ title: "New Event" }));

    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-title]")?.textContent
    ).toBe("New Event");

    panel.uninstall();
  });

  it("is idempotent on install — calling install() twice does not double-subscribe", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    panel.install();

    expect(store.getSubscriberCount()).toBe(1);

    panel.uninstall();
  });

  it("is idempotent on uninstall — calling uninstall() twice is safe", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    panel.uninstall();

    expect(() => panel.uninstall()).not.toThrow();
  });

  it("removes the overlay from the document on uninstall", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    panel.uninstall();

    expect(document.querySelector("[data-devlens-panel-host]")).toBeNull();
  });

  it("unsubscribes from the store on uninstall", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    expect(store.getSubscriberCount()).toBe(1);

    panel.uninstall();
    expect(store.getSubscriberCount()).toBe(0);
  });

  it("supports a full reinstall cycle", () => {
    const store = createFakeStore();
    const panel = createPanel(store);

    panel.install();
    panel.uninstall();
    panel.install();

    store.add(makeEvent({ title: "After Reinstall" }));

    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-title]")?.textContent
    ).toBe("After Reinstall");
    expect(store.getSubscriberCount()).toBe(1);

    panel.uninstall();
  });

  it("slices the initial render to MAX_RENDERED_EVENTS", () => {
    const manyEvents = Array.from({ length: 500 }, (_, i) =>
      makeEvent({ title: `Event ${i}` })
    );
    const store = createFakeStore(manyEvents);
    const panel = createPanel(store);

    panel.install();

    const rows = getPanelRoot()?.querySelectorAll("[data-devlens-event-row]");
    expect(rows).toHaveLength(300);

    // Confirm it's the *last* 300, not the first — panel.ts uses
    // .slice(-MAX_RENDERED_EVENTS), so the tail of the store should win.
    const firstRenderedTitle = getPanelRoot()?.querySelector(
      "[data-devlens-event-title]"
    )?.textContent;
    expect(firstRenderedTitle).toBe("Event 200");

    panel.uninstall();
  });

  it("keeps rendering only the last MAX_RENDERED_EVENTS when a new event arrives while already over the limit", () => {
    const manyEvents = Array.from({ length: 500 }, (_, i) =>
      makeEvent({ title: `Event ${i}` })
    );
    const store = createFakeStore(manyEvents);
    const panel = createPanel(store);

    panel.install();
    store.add(makeEvent({ title: "Event 500" }));

    const rows = getPanelRoot()?.querySelectorAll("[data-devlens-event-row]");
    expect(rows).toHaveLength(300);

    const firstRenderedTitle = getPanelRoot()?.querySelector(
      "[data-devlens-event-title]"
    )?.textContent;
    expect(firstRenderedTitle).toBe("Event 201");

    const titleElements = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    );
    const lastRenderedTitle =
      titleElements[titleElements.length - 1]?.textContent;
    expect(lastRenderedTitle).toBe("Event 500");

    panel.uninstall();
  });
});

describe("createPanel selection behavior", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("renders the selected event into the inspector when a row is clicked", () => {
    const store = createFakeStore([
      makeEvent({ title: "First Event" }),
      makeEvent({ title: "Second Event" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const events = store.getAll();
    clickRow(events[1].id);

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Second Event");

    panel.uninstall();
  });

  it("adds data-selected to the clicked row", () => {
    const store = createFakeStore([makeEvent(), makeEvent()]);
    const panel = createPanel(store);
    panel.install();

    const events = store.getAll();
    clickRow(events[0].id);

    const row = getPanelRoot()?.querySelector(
      `[data-devlens-event-id="${events[0].id}"]`
    );
    expect(row?.hasAttribute("data-selected")).toBe(true);

    panel.uninstall();
  });

  it("moves the row highlight when a different row is clicked", () => {
    const store = createFakeStore([makeEvent(), makeEvent()]);
    const panel = createPanel(store);
    panel.install();

    const events = store.getAll();
    clickRow(events[0].id);
    clickRow(events[1].id);

    const firstRow = getPanelRoot()?.querySelector(
      `[data-devlens-event-id="${events[0].id}"]`
    );
    const secondRow = getPanelRoot()?.querySelector(
      `[data-devlens-event-id="${events[1].id}"]`
    );
    expect(firstRow?.hasAttribute("data-selected")).toBe(false);
    expect(secondRow?.hasAttribute("data-selected")).toBe(true);

    panel.uninstall();
  });

  it("does not re-render the event list when selection changes", () => {
    const store = createFakeStore([makeEvent(), makeEvent()]);
    const panel = createPanel(store);
    panel.install();

    const rowsBefore = getPanelRoot()?.querySelectorAll(
      "[data-devlens-event-row]"
    );
    const nodeBefore = rowsBefore?.[0];

    clickRow(store.getAll()[1].id);

    const rowsAfter = getPanelRoot()?.querySelectorAll(
      "[data-devlens-event-row]"
    );
    // Same DOM node reference, not a rebuilt one — proves selection
    // changes don't trigger event-list reconstruction, per
    // inspection.md's Panel state model decision.
    expect(rowsAfter?.[0]).toBe(nodeBefore);

    panel.uninstall();
  });

  it("re-applies the row highlight after a Store update rebuilds the list", () => {
    const store = createFakeStore([makeEvent({ title: "Selected" })]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);

    store.add(makeEvent({ title: "New Event" }));

    const row = getPanelRoot()?.querySelector(
      `[data-devlens-event-id="${selectedId}"]`
    );
    expect(row?.hasAttribute("data-selected")).toBe(true);
    // Inspector still reflects the original selection — a Store
    // update alone must not change what's selected.
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Selected");

    panel.uninstall();
  });

  it("retains selection (inspector still shows it) when the selected event scrolls beyond MAX_RENDERED_EVENTS", () => {
    const store = createFakeStore([makeEvent({ title: "Will Scroll Out" })]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);

    for (let i = 0; i < 300; i++) {
      store.add(makeEvent({ title: `Filler ${i}` }));
    }

    // The row itself is gone — it scrolled beyond the rendered window —
    // but the inspector still reflects the selection per the spec's
    // persistence rule ("selection is retained ... only one
    // representation of it has left view").
    expect(
      getPanelRoot()?.querySelector(
        `[data-devlens-event-id="${selectedId}"]`
      )
    ).toBeNull();
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Will Scroll Out");

    panel.uninstall();
  });

  it("ignores clicks that don't land on a row", () => {
    const store = createFakeStore([makeEvent({ title: "Only Event" })]);
    const panel = createPanel(store);
    panel.install();

    getPanelRoot()
      ?.querySelector("[data-devlens-event-list]")
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();

    panel.uninstall();
  });
});

describe("createPanel filtering behavior (Navigation Context)", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("behaves identically to no filtering when setFilters is given the empty filter state", () => {
    const store = createFakeStore([
      makeEvent({ title: "First Event" }),
      makeEvent({ title: "Second Event" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: [], severities: [] });

    const rows = getPanelRoot()?.querySelectorAll("[data-devlens-event-row]");
    expect(rows).toHaveLength(2);

    panel.uninstall();
  });

  it("reduces the rendered list to only events matching the active filter", () => {
    const store = createFakeStore([
      makeEvent({ title: "A Runtime Event", category: "runtime" }),
      makeEvent({ title: "A Console Event", category: "console" }),
      makeEvent({ title: "Another Runtime Event", category: "runtime" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: ["runtime"], severities: [] });

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);

    expect(titles).toEqual(["A Runtime Event", "Another Runtime Event"]);

    panel.uninstall();
  });

  it("applies the filter before windowing to MAX_RENDERED_EVENTS, not within an already-windowed slice", () => {
    // 400 filler console events, then a single runtime event near the
    // very start of the Store. If windowing happened before filtering,
    // the last 300 events (all console) would contain zero runtime
    // events, and this filter would incorrectly show nothing.
    const events = [
      makeEvent({ title: "The Runtime Event", category: "runtime" }),
      ...Array.from({ length: 400 }, (_, i) =>
        makeEvent({ title: `Filler ${i}`, category: "console" })
      ),
    ];
    const store = createFakeStore(events);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: ["runtime"], severities: [] });

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);

    expect(titles).toEqual(["The Runtime Event"]);

    panel.uninstall();
  });

  it("retains selection when the selected event still matches the active filter", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Selection", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);

    panel.setFilters({ categories: ["runtime"], severities: [] });

    expect(
      getPanelRoot()
        ?.querySelector(`[data-devlens-event-id="${selectedId}"]`)
        ?.hasAttribute("data-selected")
    ).toBe(true);
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Runtime Selection");

    panel.uninstall();
  });

  it("clears selection when the selected event is excluded by a newly-applied filter", () => {
    const store = createFakeStore([
      makeEvent({ title: "Console Selection", category: "console" }),
      makeEvent({ title: "Runtime Event", category: "runtime" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Console Selection");

    // The active filter now excludes the console category entirely —
    // unlike scrolling beyond MAX_RENDERED_EVENTS, the event is no
    // longer part of the Navigation Context at all.
    panel.setFilters({ categories: ["runtime"], severities: [] });

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();
    expect(
      getPanelRoot()?.querySelector(`[data-devlens-event-id="${selectedId}"]`)
    ).toBeNull();

    panel.uninstall();
  });

  it("continues respecting the active filter when the Store receives a new event", () => {
    const store = createFakeStore([
      makeEvent({ title: "Existing Runtime", category: "runtime" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: ["runtime"], severities: [] });
    store.add(makeEvent({ title: "New Console Event", category: "console" }));
    store.add(makeEvent({ title: "New Runtime Event", category: "runtime" }));

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);

    expect(titles).toEqual(["Existing Runtime", "New Runtime Event"]);

    panel.uninstall();
  });

  it("re-renders the previously excluded events once the filter is cleared", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: ["runtime"], severities: [] });
    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(1);

    panel.setFilters({ categories: [], severities: [] });
    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(2);

    panel.uninstall();
  });
});

describe("createPanel toolbar integration", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function toolbarCheckbox(group: string, value: string): HTMLInputElement {
    const el = getPanelRoot()?.querySelector<HTMLInputElement>(
      `[data-devlens-toolbar-${group}-checkbox][data-value="${value}"]`
    );
    if (!el) throw new Error(`toolbar checkbox not found: ${group}/${value}`);
    return el;
  }

  function toggleToolbarCheckbox(group: string, value: string): void {
    const el = toolbarCheckbox(group, value);
    el.checked = !el.checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("mounts the toolbar above the event list in DOM order", () => {
    const store = createFakeStore();
    const panel = createPanel(store);
    panel.install();

    const children = Array.from(getPanelRoot()?.children ?? []);
    const toolbarIndex = children.findIndex((el) =>
      el.hasAttribute("data-devlens-toolbar")
    );
    const listIndex = children.findIndex((el) =>
      el.hasAttribute("data-devlens-event-list")
    );

    expect(toolbarIndex).toBeGreaterThanOrEqual(0);
    expect(listIndex).toBeGreaterThan(toolbarIndex);

    panel.uninstall();
  });

  it("actually checking a category checkbox in the mounted toolbar narrows the rendered list", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    toggleToolbarCheckbox("category", "runtime");

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Runtime Event"]);

    panel.uninstall();
  });

  it("unchecking a toolbar checkbox restores the previously excluded events", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    toggleToolbarCheckbox("category", "runtime"); // check
    toggleToolbarCheckbox("category", "runtime"); // uncheck

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Runtime Event", "Console Event"]);

    panel.uninstall();
  });

  it("resets the toolbar's checkbox state on a fresh install after uninstall", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);

    panel.install();
    toggleToolbarCheckbox("category", "runtime");
    panel.uninstall();

    panel.install();

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Runtime Event", "Console Event"]);
    expect(toolbarCheckbox("category", "runtime").checked).toBe(false);

    panel.uninstall();
  });
});

describe("createPanel search behavior (Navigation Context)", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("behaves identically to no search when setSearchQuery is given an empty string", () => {
    const store = createFakeStore([
      makeEvent({ title: "First Event" }),
      makeEvent({ title: "Second Event" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setSearchQuery("");

    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(2);

    panel.uninstall();
  });

  it("reduces the rendered list to only events matching the search query", () => {
    const store = createFakeStore([
      makeEvent({ title: "Timeout connecting to database" }),
      makeEvent({ title: "Unrelated console message" }),
      makeEvent({ message: "another timeout, this time on the socket" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setSearchQuery("timeout");

    const rows = getPanelRoot()?.querySelectorAll("[data-devlens-event-row]");
    expect(rows).toHaveLength(2);

    panel.uninstall();
  });

  it("matches case-insensitively and trims whitespace, same as the underlying engine", () => {
    const store = createFakeStore([makeEvent({ title: "Network Timeout" })]);
    const panel = createPanel(store);
    panel.install();

    panel.setSearchQuery("  NETWORK  ");

    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(1);

    panel.uninstall();
  });

  it("applies search before windowing to MAX_RENDERED_EVENTS, not within an already-windowed slice", () => {
    const events = [
      makeEvent({ title: "The Unique Match" }),
      ...Array.from({ length: 400 }, (_, i) =>
        makeEvent({ title: `Filler ${i}` })
      ),
    ];
    const store = createFakeStore(events);
    const panel = createPanel(store);
    panel.install();

    panel.setSearchQuery("unique match");

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["The Unique Match"]);

    panel.uninstall();
  });

  it("clears selection when the selected event is excluded by a newly-applied search query", () => {
    const store = createFakeStore([
      makeEvent({ title: "Selected Event" }),
      makeEvent({ title: "Other Event" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Selected Event");

    panel.setSearchQuery("other");

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();

    panel.uninstall();
  });

  it("retains selection when the selected event still matches the active search query", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Failure" }),
      makeEvent({ title: "Console Log" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const selectedId = store.getAll()[0].id;
    clickRow(selectedId);

    panel.setSearchQuery("failure");

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
        ?.textContent
    ).toBe("Runtime Failure");

    panel.uninstall();
  });

  it("continues respecting the active search query when the Store receives a new event", () => {
    const store = createFakeStore([makeEvent({ title: "Existing Timeout" })]);
    const panel = createPanel(store);
    panel.install();

    panel.setSearchQuery("timeout");
    store.add(makeEvent({ title: "Unrelated Event" }));
    store.add(makeEvent({ title: "New Timeout Event" }));

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Existing Timeout", "New Timeout Event"]);

    panel.uninstall();
  });

  it("resets the search query on a fresh install after uninstall", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event" }),
      makeEvent({ title: "Console Event" }),
    ]);
    const panel = createPanel(store);

    panel.install();
    panel.setSearchQuery("runtime");
    panel.uninstall();

    panel.install();

    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(2);

    panel.uninstall();
  });

  describe("composition with filtering", () => {
    it("applies search on top of an active filter — both narrow the Navigation Context together", () => {
      const store = createFakeStore([
        makeEvent({ title: "Runtime Timeout", category: "runtime" }),
        makeEvent({ title: "Runtime Success", category: "runtime" }),
        makeEvent({ title: "Console Timeout", category: "console" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.setFilters({ categories: ["runtime"], severities: [] });
      panel.setSearchQuery("timeout");

      const titles = Array.from(
        getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
      ).map((el) => el.textContent);
      expect(titles).toEqual(["Runtime Timeout"]);

      panel.uninstall();
    });

    it("re-includes events once the search query is cleared, respecting the still-active filter", () => {
      const store = createFakeStore([
        makeEvent({ title: "Runtime Timeout", category: "runtime" }),
        makeEvent({ title: "Runtime Success", category: "runtime" }),
        makeEvent({ title: "Console Timeout", category: "console" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.setFilters({ categories: ["runtime"], severities: [] });
      panel.setSearchQuery("timeout");
      panel.setSearchQuery("");

      const titles = Array.from(
        getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
      ).map((el) => el.textContent);
      expect(titles).toEqual(["Runtime Timeout", "Runtime Success"]);

      panel.uninstall();
    });
  });
});

describe("createPanel search box integration", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function searchInput(): HTMLInputElement {
    const el = getPanelRoot()?.querySelector<HTMLInputElement>(
      "[data-devlens-search-input]"
    );
    if (!el) throw new Error("search input not found");
    return el;
  }

  function typeIntoSearch(value: string): void {
    const input = searchInput();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("mounts the search box in DOM order after the toolbar and before the event list", () => {
    const store = createFakeStore();
    const panel = createPanel(store);
    panel.install();

    const children = Array.from(getPanelRoot()?.children ?? []);
    const toolbarIndex = children.findIndex((el) =>
      el.hasAttribute("data-devlens-toolbar")
    );
    const searchIndex = children.findIndex((el) =>
      el.hasAttribute("data-devlens-search")
    );
    const listIndex = children.findIndex((el) =>
      el.hasAttribute("data-devlens-event-list")
    );

    expect(toolbarIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThan(toolbarIndex);
    expect(listIndex).toBeGreaterThan(searchIndex);

    panel.uninstall();
  });

  it("actually typing into the mounted search input narrows the rendered list", () => {
    const store = createFakeStore([
      makeEvent({ title: "Network Timeout" }),
      makeEvent({ title: "Console Log" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    typeIntoSearch("timeout");

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Network Timeout"]);

    panel.uninstall();
  });

  it("clearing the search input restores the previously excluded events", () => {
    const store = createFakeStore([
      makeEvent({ title: "Network Timeout" }),
      makeEvent({ title: "Console Log" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    typeIntoSearch("timeout");
    typeIntoSearch("");

    const titles = Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Network Timeout", "Console Log"]);

    panel.uninstall();
  });

  it("resets the search box's input value on a fresh install after uninstall", () => {
    const store = createFakeStore([makeEvent({ title: "Runtime Event" })]);
    const panel = createPanel(store);

    panel.install();
    typeIntoSearch("runtime");
    panel.uninstall();

    panel.install();

    expect(searchInput().value).toBe("");
    expect(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-row]")
    ).toHaveLength(1);

    panel.uninstall();
  });
});

describe("createPanel search presentation", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function searchInput(): HTMLInputElement {
    const el = getPanelRoot()?.querySelector<HTMLInputElement>(
      "[data-devlens-search-input]"
    );
    if (!el) throw new Error("search input not found");
    return el;
  }

  function typeIntoSearch(value: string): void {
    const input = searchInput();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("highlights matches in the rendered rows when typing into the mounted search box", () => {
    const store = createFakeStore([makeEvent({ title: "Network Timeout" })]);
    const panel = createPanel(store);
    panel.install();

    typeIntoSearch("timeout");

    expect(
      getPanelRoot()?.querySelector("[data-devlens-match]")?.textContent
    ).toBe("Timeout");

    panel.uninstall();
  });

  it("highlights matches in the inspector when an event is selected under an active search", () => {
    const store = createFakeStore([makeEvent({ title: "Network Timeout" })]);
    const panel = createPanel(store);
    panel.install();

    typeIntoSearch("timeout");
    clickRow(store.getAll()[0].id);

    expect(
      getPanelRoot()?.querySelector(
        "[data-devlens-inspector-title] [data-devlens-match]"
      )?.textContent
    ).toBe("Timeout");

    panel.uninstall();
  });

  it("shows the Store-empty message when no events have been captured at all", () => {
    const store = createFakeStore();
    const panel = createPanel(store);
    panel.install();

    expect(
      getPanelRoot()?.querySelector('[data-devlens-event-list-empty="store"]')
    ).not.toBeNull();

    panel.uninstall();
  });

  it("shows the filtered-empty message when the Store has events but the active search excludes all of them", () => {
    const store = createFakeStore([makeEvent({ title: "Console Log" })]);
    const panel = createPanel(store);
    panel.install();

    typeIntoSearch("nonexistent");

    expect(
      getPanelRoot()?.querySelector(
        '[data-devlens-event-list-empty="filtered"]'
      )
    ).not.toBeNull();

    panel.uninstall();
  });

  it("shows a match count only once search narrows the list, and removes it once cleared", () => {
    const store = createFakeStore([
      makeEvent({ title: "Network Timeout" }),
      makeEvent({ title: "Console Log" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-list-count]")
    ).toBeNull();

    typeIntoSearch("timeout");
    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-list-count]")
        ?.textContent
    ).toBe("1 of 2");

    typeIntoSearch("");
    expect(
      getPanelRoot()?.querySelector("[data-devlens-event-list-count]")
    ).toBeNull();

    panel.uninstall();
  });
});
describe("createPanel keyboard navigation", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function eventListElement(): HTMLElement {
    const el = getPanelRoot()?.querySelector<HTMLElement>(
      "[data-devlens-event-list]"
    );
    if (!el) throw new Error("event list not found");
    return el;
  }

  function pressKey(key: string, target: HTMLElement): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, composed: true })
    );
  }

  function selectedTitle(): string | null | undefined {
    return getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
      ?.textContent;
  }

  it("does nothing when the event list does not have focus", () => {
    const store = createFakeStore([makeEvent({ title: "First" })]);
    const panel = createPanel(store);
    panel.install();

    // No .focus() call — the list never receives focus.
    pressKey("ArrowDown", eventListElement());

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();

    panel.uninstall();
  });

  it("selects the first row on ArrowDown with the list focused and nothing selected", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    pressKey("ArrowDown", list);

    expect(selectedTitle()).toBe("First");

    panel.uninstall();
  });

  it("also selects the first row on ArrowUp with the list focused and nothing selected — not the last", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    pressKey("ArrowUp", list);

    expect(selectedTitle()).toBe("First");

    panel.uninstall();
  });

  it("moves to the next row on ArrowDown from a selected row", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
      makeEvent({ title: "Third" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    pressKey("ArrowDown", list);
    pressKey("ArrowDown", list);

    expect(selectedTitle()).toBe("Second");

    panel.uninstall();
  });

  it("moves to the previous row on ArrowUp from a selected row", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
      makeEvent({ title: "Third" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[2].id); // select Third
    pressKey("ArrowUp", list);

    expect(selectedTitle()).toBe("Second");

    panel.uninstall();
  });

  it("stops on the last row — ArrowDown past the end does not wrap to the first", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[1].id); // select Second (last)
    pressKey("ArrowDown", list);

    expect(selectedTitle()).toBe("Second");

    panel.uninstall();
  });

  it("stops on the first row — ArrowUp past the start does not wrap to the last", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[0].id); // select First
    pressKey("ArrowUp", list);

    expect(selectedTitle()).toBe("First");

    panel.uninstall();
  });

  it("Home selects the first row regardless of current selection", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
      makeEvent({ title: "Third" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[2].id);
    pressKey("Home", list);

    expect(selectedTitle()).toBe("First");

    panel.uninstall();
  });

  it("End selects the last row regardless of current selection", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
      makeEvent({ title: "Third" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[0].id);
    pressKey("End", list);

    expect(selectedTitle()).toBe("Third");

    panel.uninstall();
  });

  it("stops navigating once focus moves to the search box", () => {
    const store = createFakeStore([
      makeEvent({ title: "First" }),
      makeEvent({ title: "Second" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    clickRow(store.getAll()[0].id);

    const searchInput = getPanelRoot()?.querySelector<HTMLInputElement>(
      "[data-devlens-search-input]"
    );
    searchInput?.focus();
    pressKey("ArrowDown", searchInput!);

    // Selection unchanged — still "First", not "Second".
    expect(selectedTitle()).toBe("First");

    panel.uninstall();
  });

  it("does nothing (no throw) when the list is focused but there are no events", () => {
    const store = createFakeStore();
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();

    expect(() => pressKey("ArrowDown", list)).not.toThrow();
    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();

    panel.uninstall();
  });

  it("navigates only the currently filtered/searched rows, not the full Store", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime One", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
      makeEvent({ title: "Runtime Two", category: "runtime" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    panel.setFilters({ categories: ["runtime"], severities: [] });

    const list = eventListElement();
    list.focus();
    pressKey("ArrowDown", list);
    expect(selectedTitle()).toBe("Runtime One");

    pressKey("ArrowDown", list);
    expect(selectedTitle()).toBe("Runtime Two");

    panel.uninstall();
  });

  it("clears selection via the existing persistence rule if a filter excludes the keyboard-selected event", () => {
    const store = createFakeStore([
      makeEvent({ title: "Runtime Event", category: "runtime" }),
      makeEvent({ title: "Console Event", category: "console" }),
    ]);
    const panel = createPanel(store);
    panel.install();

    const list = eventListElement();
    list.focus();
    pressKey("ArrowDown", list); // selects Runtime Event

    panel.setFilters({ categories: ["console"], severities: [] });

    expect(
      getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
    ).not.toBeNull();

    panel.uninstall();
  });
});

describe("createPanel pause/resume/clear/export", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function renderedTitles(): string[] {
    return Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
  }

  describe("isPaused()", () => {
    it("is false immediately after install", () => {
      const panel = createPanel(createFakeStore());
      panel.install();

      expect(panel.isPaused()).toBe(false);

      panel.uninstall();
    });

    it("becomes true after pause() and false after resume()", () => {
      const panel = createPanel(createFakeStore());
      panel.install();

      panel.pause();
      expect(panel.isPaused()).toBe(true);

      panel.resume();
      expect(panel.isPaused()).toBe(false);

      panel.uninstall();
    });

    it("pause() is idempotent — calling it twice leaves isPaused() true", () => {
      const panel = createPanel(createFakeStore());
      panel.install();

      panel.pause();
      panel.pause();
      expect(panel.isPaused()).toBe(true);

      panel.uninstall();
    });
  });

  describe("pause()", () => {
    it("stops new Store events from appearing in the rendered list", () => {
      const store = createFakeStore([makeEvent({ title: "Before Pause" })]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      store.add(makeEvent({ title: "During Pause" }));

      expect(renderedTitles()).toEqual(["Before Pause"]);

      panel.uninstall();
    });

    it("does not stop the Store from actually retaining the event", () => {
      const store = createFakeStore();
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      store.add(makeEvent({ title: "Captured While Paused" }));

      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].title).toBe("Captured While Paused");

      panel.uninstall();
    });

    it("does not prevent setFilters() from updating the rendered list live", () => {
      const store = createFakeStore([
        makeEvent({ title: "Runtime Event", category: "runtime" }),
        makeEvent({ title: "Console Event", category: "console" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      panel.setFilters({ categories: ["runtime"], severities: [] });

      expect(renderedTitles()).toEqual(["Runtime Event"]);

      panel.uninstall();
    });

    it("does not prevent setSearchQuery() from updating the rendered list live", () => {
      const store = createFakeStore([
        makeEvent({ title: "Network Timeout" }),
        makeEvent({ title: "Console Log" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      panel.setSearchQuery("timeout");

      expect(renderedTitles()).toEqual(["Network Timeout"]);

      panel.uninstall();
    });

    it("does not prevent clicking a row from updating selection live", () => {
      const store = createFakeStore([makeEvent({ title: "Clickable Event" })]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      clickRow(store.getAll()[0].id);

      expect(
        getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
          ?.textContent
      ).toBe("Clickable Event");

      panel.uninstall();
    });
  });

  describe("resume()", () => {
    it("performs one resync that reveals every event captured while paused", () => {
      const store = createFakeStore([makeEvent({ title: "Before Pause" })]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      store.add(makeEvent({ title: "During Pause One" }));
      store.add(makeEvent({ title: "During Pause Two" }));
      expect(renderedTitles()).toEqual(["Before Pause"]);

      panel.resume();

      expect(renderedTitles()).toEqual([
        "Before Pause",
        "During Pause One",
        "During Pause Two",
      ]);

      panel.uninstall();
    });

    it("resumes automatic refresh — a later Store event appears without another resume()", () => {
      const store = createFakeStore();
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      panel.resume();
      store.add(makeEvent({ title: "After Resume" }));

      expect(renderedTitles()).toEqual(["After Resume"]);

      panel.uninstall();
    });

    it("is harmless when the Panel isn't paused — just re-syncs", () => {
      const store = createFakeStore([makeEvent({ title: "Only Event" })]);
      const panel = createPanel(store);
      panel.install();

      expect(() => panel.resume()).not.toThrow();
      expect(renderedTitles()).toEqual(["Only Event"]);

      panel.uninstall();
    });
  });

  describe("clear()", () => {
    it("empties the Store", () => {
      const store = createFakeStore([makeEvent(), makeEvent()]);
      const panel = createPanel(store);
      panel.install();

      panel.clear();

      expect(store.getAll()).toEqual([]);

      panel.uninstall();
    });

    it("refreshes the rendered list immediately, despite store.clear() not calling notify()", () => {
      const store = createFakeStore([makeEvent({ title: "Will Be Cleared" })]);
      const panel = createPanel(store);
      panel.install();

      panel.clear();

      expect(renderedTitles()).toEqual([]);

      panel.uninstall();
    });

    it("clears selection via the existing persistence rule — no special case needed", () => {
      const store = createFakeStore([makeEvent({ title: "Selected Event" })]);
      const panel = createPanel(store);
      panel.install();

      clickRow(store.getAll()[0].id);
      expect(
        getPanelRoot()?.querySelector("[data-devlens-inspector-title]")
          ?.textContent
      ).toBe("Selected Event");

      panel.clear();

      expect(
        getPanelRoot()?.querySelector("[data-devlens-inspector-empty]")
      ).not.toBeNull();

      panel.uninstall();
    });

    it("runs even while paused — an explicit action bypasses the automatic-refresh gate", () => {
      const store = createFakeStore([makeEvent({ title: "Will Be Cleared" })]);
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      panel.clear();

      expect(renderedTitles()).toEqual([]);
      expect(panel.isPaused()).toBe(true);

      panel.uninstall();
    });
  });

  describe("exportEvents()", () => {
    it("returns the empty Store as an empty JSON array", () => {
      const panel = createPanel(createFakeStore());
      panel.install();

      expect(panel.exportEvents()).toBe("[]");

      panel.uninstall();
    });

    it("returns every Store event, serialized", () => {
      const events = [makeEvent({ title: "One" }), makeEvent({ title: "Two" })];
      const store = createFakeStore(events);
      const panel = createPanel(store);
      panel.install();

      const parsed = JSON.parse(panel.exportEvents());

      expect(parsed).toHaveLength(2);
      expect(parsed.map((e: DevLensEvent) => e.title)).toEqual(["One", "Two"]);

      panel.uninstall();
    });

    it("ignores active filters — exports the full Store, not the Navigation Context", () => {
      const store = createFakeStore([
        makeEvent({ title: "Runtime Event", category: "runtime" }),
        makeEvent({ title: "Console Event", category: "console" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.setFilters({ categories: ["runtime"], severities: [] });
      expect(renderedTitles()).toEqual(["Runtime Event"]); // sanity: filter is actually active

      const parsed = JSON.parse(panel.exportEvents());
      expect(parsed.map((e: DevLensEvent) => e.title).sort()).toEqual([
        "Console Event",
        "Runtime Event",
      ]);

      panel.uninstall();
    });

    it("ignores an active search query — exports the full Store", () => {
      const store = createFakeStore([
        makeEvent({ title: "Network Timeout" }),
        makeEvent({ title: "Console Log" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.setSearchQuery("timeout");
      expect(renderedTitles()).toEqual(["Network Timeout"]); // sanity: search is actually active

      const parsed = JSON.parse(panel.exportEvents());
      expect(parsed).toHaveLength(2);

      panel.uninstall();
    });

    it("reflects events captured while paused, without requiring resume() first", () => {
      const store = createFakeStore();
      const panel = createPanel(store);
      panel.install();

      panel.pause();
      store.add(makeEvent({ title: "Captured While Paused" }));

      const parsed = JSON.parse(panel.exportEvents());
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe("Captured While Paused");

      panel.uninstall();
    });
  });
});

// Integration tests: unlike the describe block above (which calls
// panel.pause()/resume()/clear()/exportEvents() directly) and
// session-controls.test.ts (which exercises the component in
// isolation against fake handlers), these click the actual rendered
// buttons inside a fully mounted Panel — proving the wiring in
// install() itself, not just each side of it independently.
describe("createPanel session controls, mounted end-to-end", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  function renderedTitles(): string[] {
    return Array.from(
      getPanelRoot()?.querySelectorAll("[data-devlens-event-title]") ?? []
    ).map((el) => el.textContent);
  }

  function clickPauseButton(): void {
    getPanelRoot()
      ?.querySelector<HTMLButtonElement>(
        "[data-devlens-session-pause-button]"
      )
      ?.click();
  }

  function pauseButtonState(): string | null {
    return (
      getPanelRoot()
        ?.querySelector("[data-devlens-session-pause-button]")
        ?.getAttribute("data-devlens-session-state") ?? null
    );
  }

  function clickClearButton(): void {
    getPanelRoot()
      ?.querySelector<HTMLButtonElement>(
        "[data-devlens-session-clear-button]"
      )
      ?.click();
  }

  function clickExportButton(): void {
    getPanelRoot()
      ?.querySelector<HTMLButtonElement>(
        "[data-devlens-session-export-button]"
      )
      ?.click();
  }

  it("renders the session controls region alongside the toolbar and search box", () => {
    const panel = createPanel(createFakeStore());
    panel.install();

    expect(
      getPanelRoot()?.querySelector("[data-devlens-session-controls]")
    ).not.toBeNull();

    panel.uninstall();
  });

  it("clicking Pause freezes the rendered list; clicking Resume reveals what arrived meanwhile", () => {
    const store = createFakeStore([makeEvent({ title: "Before Pause" })]);
    const panel = createPanel(store);
    panel.install();

    expect(pauseButtonState()).toBe("running");

    clickPauseButton();
    expect(pauseButtonState()).toBe("paused");
    expect(panel.isPaused()).toBe(true);

    store.add(makeEvent({ title: "During Pause" }));
    expect(renderedTitles()).toEqual(["Before Pause"]);

    clickPauseButton(); // now labeled "Resume"
    expect(pauseButtonState()).toBe("running");
    expect(panel.isPaused()).toBe(false);
    expect(renderedTitles()).toEqual(["Before Pause", "During Pause"]);

    panel.uninstall();
  });

  it("clicking Clear empties both the Store and the rendered list", () => {
    const store = createFakeStore([makeEvent({ title: "Will Be Cleared" })]);
    const panel = createPanel(store);
    panel.install();

    clickClearButton();

    expect(store.getAll()).toEqual([]);
    expect(renderedTitles()).toEqual([]);

    panel.uninstall();
  });

  describe("clicking Export", () => {
    let capturedBlobParts: BlobPart[] | undefined;
    let anchorClickSpy: ReturnType<typeof vi.spyOn>;
    const OriginalBlob = globalThis.Blob;

    beforeEach(() => {
      class StubBlob {
        constructor(parts: BlobPart[]) {
          capturedBlobParts = parts;
        }
      }
      // @ts-expect-error — see session-controls.test.ts for why jsdom's
      // real Blob/URL.createObjectURL aren't used here.
      globalThis.Blob = StubBlob;
      URL.createObjectURL = vi.fn(() => "blob:mock-url");
      URL.revokeObjectURL = vi.fn();
      anchorClickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.Blob = OriginalBlob;
      capturedBlobParts = undefined;
      vi.restoreAllMocks();
    });

    it("downloads exactly what panel.exportEvents() would return", () => {
      const store = createFakeStore([
        makeEvent({ title: "One" }),
        makeEvent({ title: "Two" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      const expected = panel.exportEvents();
      clickExportButton();

      expect(capturedBlobParts).toEqual([expected]);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);

      panel.uninstall();
    });

    it("exports the full Store even while a filter narrows what's rendered", () => {
      const store = createFakeStore([
        makeEvent({ title: "Runtime Event", category: "runtime" }),
        makeEvent({ title: "Console Event", category: "console" }),
      ]);
      const panel = createPanel(store);
      panel.install();

      panel.setFilters({ categories: ["runtime"], severities: [] });
      expect(renderedTitles()).toEqual(["Runtime Event"]); // sanity

      clickExportButton();

      const parsed = JSON.parse(capturedBlobParts![0] as string);
      expect(parsed.map((e: DevLensEvent) => e.title).sort()).toEqual([
        "Console Event",
        "Runtime Event",
      ]);

      panel.uninstall();
    });
  });
});
