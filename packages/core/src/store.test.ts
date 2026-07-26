import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "./event-bus";
import { createEventStore } from "./store";
import { connectStoreToBus } from "./store-bus-connector";
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

describe("EventStore (standalone, no bus)", () => {
  it("add/getAll work with no bus involved at all", () => {
    const store = createEventStore();
    const event = createEventBus().report(baseInput({ title: "manual" }));
    store.add(event);
    expect(store.getAll()).toHaveLength(1);
  });

  it("getByCategory filters correctly", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput({ category: "runtime" })));
    store.add(bus.report(baseInput({ category: "network" })));
    expect(store.getByCategory("network")).toHaveLength(1);
  });

  it("filter applies an arbitrary predicate", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput({ severity: "error" })));
    store.add(bus.report(baseInput({ severity: "warn" })));
    expect(store.filter((e) => e.severity === "error")).toHaveLength(1);
  });

  it("clear empties the store", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.clear();
    expect(store.getAll()).toHaveLength(0);
  });

  it("subscribe/unsubscribe work independent of any bus", () => {
    const store = createEventStore();
    const bus = createEventBus();
    const handler = vi.fn();
    const dispose = store.subscribe(handler);
    store.add(bus.report(baseInput()));
    expect(handler).toHaveBeenCalledTimes(1);
    dispose();
    store.add(bus.report(baseInput()));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("respects maxEvents", () => {
    const store = createEventStore({ maxEvents: 2 });
    const bus = createEventBus();
    store.add(bus.report(baseInput({ title: "one" })));
    store.add(bus.report(baseInput({ title: "two" })));
    store.add(bus.report(baseInput({ title: "three" })));
    expect(store.getAll().map((e) => e.title)).toEqual(["two", "three"]);
  });
});

describe("connectStoreToBus", () => {
  it("backfills existing bus history on connect (replay default true)", () => {
    const bus = createEventBus();
    bus.report(baseInput({ title: "before store existed" }));
    const store = createEventStore();
    connectStoreToBus(bus, store);
    expect(store.getAll()).toHaveLength(1);
  });

  it("does not backfill when replay: false", () => {
    const bus = createEventBus();
    bus.report(baseInput({ title: "before" }));
    const store = createEventStore();
    connectStoreToBus(bus, store, { replay: false });
    expect(store.getAll()).toHaveLength(0);
  });

  it("stays live for events reported after connecting", () => {
    const bus = createEventBus();
    const store = createEventStore();
    connectStoreToBus(bus, store);
    bus.report(baseInput());
    expect(store.getAll()).toHaveLength(1);
  });

  it("disconnecting stops the store from receiving further bus events", () => {
    const bus = createEventBus();
    const store = createEventStore();
    const disconnect = connectStoreToBus(bus, store);
    disconnect();
    bus.report(baseInput());
    expect(store.getAll()).toHaveLength(0);
  });

  it("clearing the store does not affect the bus's own buffer", () => {
    const bus = createEventBus();
    const store = createEventStore();
    connectStoreToBus(bus, store);
    bus.report(baseInput());
    store.clear();
    expect(bus.getEvents()).toHaveLength(1);
  });
});