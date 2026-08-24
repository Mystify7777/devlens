import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "./event-bus";
import { createEventStore } from "./store";
import { connectStoreToBus } from "./store-bus-connector";
import { DEFAULT_STORE_SIZE } from "./constants";
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

describe("EventStore.capacity", () => {
  it("returns the configured maxEvents value", () => {
    const store = createEventStore({ maxEvents: 500 });
    expect(store.capacity).toBe(500);
  });

  it("defaults to DEFAULT_STORE_SIZE when maxEvents is not specified", () => {
    const store = createEventStore();
    expect(store.capacity).toBe(DEFAULT_STORE_SIZE);
  });

  it("is unchanged after add()", () => {
    const store = createEventStore({ maxEvents: 5 });
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    expect(store.capacity).toBe(5);
  });

  it("is unchanged after clear()", () => {
    const store = createEventStore({ maxEvents: 5 });
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.clear();
    expect(store.capacity).toBe(5);
  });

  it("is unchanged after RingBuffer eviction", () => {
    const store = createEventStore({ maxEvents: 2 });
    const bus = createEventBus();
    store.add(bus.report(baseInput({ title: "one" })));
    store.add(bus.report(baseInput({ title: "two" })));
    store.add(bus.report(baseInput({ title: "three" }))); // evicts "one"
    expect(store.capacity).toBe(2);
  });
});

// ADR-0012: a direct RingBuffer.size passthrough — current occupancy,
// distinct from capacity (the configured maximum). See the ADR's
// behavioral contract table for the full set of conditions this
// mirrors.
describe("EventStore.size", () => {
  it("is 0 for a newly created, empty Store", () => {
    const store = createEventStore();
    expect(store.size).toBe(0);
  });

  it("increments by exactly 1 after add()", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    expect(store.size).toBe(1);
    store.add(bus.report(baseInput()));
    expect(store.size).toBe(2);
  });

  it("increments by the batch length, in one step, after addMany()", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.addMany([
      bus.report(baseInput({ title: "a" })),
      bus.report(baseInput({ title: "b" })),
      bus.report(baseInput({ title: "c" })),
    ]);
    expect(store.size).toBe(3);
  });

  it("is unchanged by addMany([]) — matches addMany()'s true-no-op contract", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.addMany([]);
    expect(store.size).toBe(1);
  });

  it("resets to 0 after clear()", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.add(bus.report(baseInput()));
    store.clear();
    expect(store.size).toBe(0);
  });

  it("is pinned at capacity once the Store is full, even as further events are added and evicted", () => {
    const store = createEventStore({ maxEvents: 3 });
    const bus = createEventBus();
    store.add(bus.report(baseInput({ title: "one" })));
    store.add(bus.report(baseInput({ title: "two" })));
    store.add(bus.report(baseInput({ title: "three" })));
    expect(store.size).toBe(3);
    store.add(bus.report(baseInput({ title: "four" }))); // evicts "one"
    expect(store.size).toBe(3); // not 4
  });

  it("is pinned at capacity even when a single addMany() batch alone exceeds it", () => {
    const store = createEventStore({ maxEvents: 3 });
    const bus = createEventBus();
    store.addMany([
      bus.report(baseInput({ title: "a" })),
      bus.report(baseInput({ title: "b" })),
      bus.report(baseInput({ title: "c" })),
      bus.report(baseInput({ title: "d" })),
      bus.report(baseInput({ title: "e" })),
    ]);
    expect(store.size).toBe(3);
  });

  it("resets to 0 after destroy()", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.destroy();
    expect(store.size).toBe(0);
  });

  it("behaves exactly as a fresh Store when reused after destroy()", () => {
    const store = createEventStore({ maxEvents: 2 });
    const bus = createEventBus();
    store.add(bus.report(baseInput()));
    store.add(bus.report(baseInput()));
    store.destroy();

    expect(store.size).toBe(0);
    store.add(bus.report(baseInput()));
    expect(store.size).toBe(1);
  });

  it("always equals getAll().length", () => {
    const store = createEventStore();
    const bus = createEventBus();
    store.add(bus.report(baseInput({ title: "a" })));
    store.add(bus.report(baseInput({ title: "b" })));
    expect(store.size).toBe(store.getAll().length);
  });
});

describe("EventStore.addMany()", () => {
  it("preserves supplied event order", () => {
    const store = createEventStore();
    const bus = createEventBus();
    const a = bus.report(baseInput({ title: "alpha" }));
    const b = bus.report(baseInput({ title: "beta" }));
    const c = bus.report(baseInput({ title: "gamma" }));
    store.addMany([a, b, c]);
    expect(store.getAll().map((e) => e.title)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("notifies subscribers exactly once for a non-empty batch", () => {
    const store = createEventStore();
    const bus = createEventBus();
    const handler = vi.fn();
    store.subscribe(handler);
    const a = bus.report(baseInput({ title: "one" }));
    const b = bus.report(baseInput({ title: "two" }));
    const c = bus.report(baseInput({ title: "three" }));
    store.addMany([a, b, c]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("is a true no-op for an empty array — no mutation, no notification", () => {
    const store = createEventStore();
    const handler = vi.fn();
    store.subscribe(handler);
    store.addMany([]);
    expect(store.getAll()).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("follows normal RingBuffer eviction for an oversized batch", () => {
    const store = createEventStore({ maxEvents: 3 });
    const bus = createEventBus();
    const events = ["a", "b", "c", "d", "e"].map((t) =>
      bus.report(baseInput({ title: t }))
    );
    store.addMany(events); // 5 events, capacity 3 → oldest 2 evicted
    expect(store.getAll().map((e) => e.title)).toEqual(["c", "d", "e"]);
    expect(store.getAll()).toHaveLength(3);
  });

  it("performs no validation — stores whatever it is given without throwing", () => {
    const store = createEventStore();
    const bus = createEventBus();
    const valid = bus.report(baseInput({ title: "real" }));
    // Pass an unrecognised extra field via cast; addMany() must not inspect it
    const withExtra = { ...valid, unknownField: "sneaky" } as unknown as import("./types").DevLensEvent;
    expect(() => store.addMany([withExtra])).not.toThrow();
    expect(store.getAll()).toHaveLength(1);
  });

  it("performs no freezing — returned events are whatever was passed in", () => {
    const store = createEventStore();
    const bus = createEventBus();
    const event = bus.report(baseInput()); // already frozen by bus.report
    store.addMany([event]);
    // The event in the store is the exact same reference (not re-frozen)
    expect(store.getAll()[0]).toBe(event);
  });

  it("single-event addMany and add leave the store in the same state", () => {
    const bus = createEventBus();
    const storeA = createEventStore();
    const storeB = createEventStore();
    const event = bus.report(baseInput({ title: "same" }));
    storeA.add(event);
    storeB.addMany([event]);
    expect(storeA.getAll()).toEqual(storeB.getAll());
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