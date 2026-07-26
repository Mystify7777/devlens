import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "./event-bus";
import { createEventStore } from "./store";
import type { DevLensEventInput } from "./types";

function baseInput(overrides: Partial<DevLensEventInput> = {}): DevLensEventInput {
  return {
    origin: "test",
    category: "runtime",
    severity: "error",
    title: "Test event",
    message: "Something happened",
    ...overrides,
  };
}

describe("EventStore", () => {
  it("captures events already in the bus's replay buffer at creation time", () => {
    const bus = createEventBus();
    bus.report(baseInput({ title: "before store existed" }));
    const store = createEventStore(bus);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].title).toBe("before store existed");
  });

  it("captures events reported after the store is created", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    bus.report(baseInput({ title: "after" }));
    expect(store.getAll()).toHaveLength(1);
  });

  it("getByCategory filters correctly", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    bus.report(baseInput({ category: "runtime" }));
    bus.report(baseInput({ category: "network" }));
    expect(store.getByCategory("network")).toHaveLength(1);
    expect(store.getByCategory("network")[0].category).toBe("network");
  });

  it("find applies an arbitrary predicate", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    bus.report(baseInput({ severity: "error" }));
    bus.report(baseInput({ severity: "warn" }));
    const errors = store.find((e) => e.severity === "error");
    expect(errors).toHaveLength(1);
  });

  it("clear empties the store without affecting the bus", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    bus.report(baseInput());
    store.clear();
    expect(store.getAll()).toHaveLength(0);
    expect(bus.getEvents()).toHaveLength(1); // bus's own buffer untouched
  });

  it("subscribe notifies on new events", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    const handler = vi.fn();
    store.subscribe(handler);
    bus.report(baseInput());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops notifications", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    const handler = vi.fn();
    const dispose = store.subscribe(handler);
    dispose();
    bus.report(baseInput());
    expect(handler).not.toHaveBeenCalled();
  });

  it("respects maxEvents", () => {
    const bus = createEventBus();
    const store = createEventStore(bus, { maxEvents: 2 });
    bus.report(baseInput({ title: "one" }));
    bus.report(baseInput({ title: "two" }));
    bus.report(baseInput({ title: "three" }));
    expect(store.getAll()).toHaveLength(2);
    expect(store.getAll().map((e) => e.title)).toEqual(["two", "three"]);
  });

  it("destroy stops receiving events from the bus", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    store.destroy();
    bus.report(baseInput());
    expect(store.getAll()).toHaveLength(0);
  });

  it("add() can be used directly for manual seeding", () => {
    const bus = createEventBus();
    const store = createEventStore(bus);
    const manualEvent = bus.report(baseInput({ title: "manual" }));
    store.clear();
    store.add(manualEvent);
    expect(store.getAll()).toHaveLength(1);
  });
});