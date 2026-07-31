// packages/panel/src/panel.test.ts
import { describe, it, expect, beforeEach } from "vitest";
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
    // changes don't trigger event-list reconstruction, per ADR-0009's
    // Panel state model decision.
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