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