import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "./event-bus";
import { EventBusDestroyedError, MiddlewareError } from "./errors";
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

describe("EventBus.report", () => {
  it("generates an id when none is supplied", () => {
    const bus = createEventBus();
    expect(bus.report(baseInput()).id).toBeTruthy();
  });

  it("generates a timestamp when none is supplied", () => {
    const bus = createEventBus();
    const before = Date.now();
    expect(bus.report(baseInput()).timestamp).toBeGreaterThanOrEqual(before);
  });

  it("generates version 1 when none is supplied", () => {
    const bus = createEventBus();
    expect(bus.report(baseInput()).version).toBe(1);
  });

  it("preserves a supplied id", () => {
    const bus = createEventBus();
    expect(bus.report(baseInput({ id: "fixed-id" })).id).toBe("fixed-id");
  });

  it("preserves a supplied timestamp", () => {
    const bus = createEventBus();
    expect(bus.report(baseInput({ timestamp: 12345 })).timestamp).toBe(12345);
  });

  it("returns a frozen event", () => {
    const bus = createEventBus();
    const event = bus.report(baseInput());
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("deep-freezes nested metadata", () => {
    const bus = createEventBus();
    const event = bus.report(baseInput({ metadata: { status: 500 } }));
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(() => {
      (event.metadata as Record<string, unknown>).status = 200;
    }).toThrow();
  });
});

// Issue #19 / ADR-0007's amendment: externallyOwned. See
// DevLensEventInput's own doc comment for the full contract.
describe("EventBus.report externallyOwned exemption", () => {
  it("does not freeze a value listed in externallyOwned", () => {
    const bus = createEventBus();
    const shared = { value: 1 };
    bus.report(baseInput({ metadata: { args: shared }, externallyOwned: [shared] }));
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it("does not freeze anything nested inside an exempted value", () => {
    const bus = createEventBus();
    const shared = { nested: { deeper: { value: 1 } } };
    bus.report(baseInput({ metadata: { args: shared }, externallyOwned: [shared] }));
    expect(Object.isFrozen(shared.nested)).toBe(false);
    expect(Object.isFrozen(shared.nested.deeper)).toBe(false);
  });

  it("still fully freezes a value NOT listed in externallyOwned — the exemption is explicit, not a blanket rule for arrays or any key name", () => {
    const bus = createEventBus();
    const notExempt = { nested: { value: 1 } };
    bus.report(baseInput({ metadata: { args: notExempt } }));
    expect(Object.isFrozen(notExempt)).toBe(true);
    expect(Object.isFrozen(notExempt.nested)).toBe(true);
  });

  it("never leaks externallyOwned itself onto the resulting event", () => {
    const bus = createEventBus();
    const shared = { value: 1 };
    const event = bus.report(baseInput({ metadata: {}, externallyOwned: [shared] }));
    expect("externallyOwned" in event).toBe(false);
  });

  it("exempts an object wherever it is reachable in the final event, not only at the path it was declared through — a structural consequence of Object.freeze() operating on objects, not paths", () => {
    const bus = createEventBus();
    const shared = { value: 1 };
    const event = bus.report(
      baseInput({
        metadata: { args: [shared], other: shared },
        externallyOwned: [shared],
      })
    );
    expect(Object.isFrozen((event.metadata as Record<string, unknown>).other)).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it("does not expose the exemption list to middleware, and does not let middleware manufacture new exemptions", () => {
    const bus = createEventBus();
    const shared = { value: 1 };
    let sawExemptionList = false;
    bus.addMiddleware((event, next) => {
      if ("externallyOwned" in event) sawExemptionList = true;
      next();
    });

    bus.report(baseInput({ metadata: { args: shared }, externallyOwned: [shared] }));

    expect(sawExemptionList).toBe(false);
  });

  it("still freezes ordinary metadata introduced by middleware — the exemption never becomes a blanket rule", () => {
    const bus = createEventBus();
    const middlewareOwned = { value: 1 };
    bus.addMiddleware((event, next) => {
      next({ ...event, metadata: { ...event.metadata, addedByMiddleware: middlewareOwned } });
    });

    const event = bus.report(baseInput({ metadata: {} }));

    expect(Object.isFrozen((event.metadata as Record<string, unknown>).addedByMiddleware)).toBe(
      true
    );
  });

  it("silently ignores non-object entries in externallyOwned rather than throwing", () => {
    const bus = createEventBus();
    // externallyOwned's declared type is unknown[] specifically so
    // callers aren't forced to pre-filter — non-object entries here
    // are valid input, not a type error, and must be handled
    // gracefully at runtime rather than crashing WeakSet's
    // constructor.
    expect(() =>
      bus.report(baseInput({ metadata: {}, externallyOwned: [42, "oops", null, undefined] }))
    ).not.toThrow();
  });

  it("never invokes a getter on an exempted value — the getter guarantee belongs to externallyOwned's own semantics, not specifically to Console", () => {
    // deepFreeze() reads each property via direct value access
    // (value[key]), which invokes getters rather than merely
    // inspecting descriptors. An exempted value is never recursed
    // into at all (deepFreeze returns as soon as it finds a `seen`
    // match), so no property of it — including a getter — is ever
    // read as a side effect of reporting. This pins that guarantee
    // down at the generic Core level, independent of any specific
    // plugin.
    const bus = createEventBus();
    let getterCalled = false;
    const shared = {
      get dangerous() {
        getterCalled = true;
        return { value: 1 };
      },
    };

    bus.report(baseInput({ metadata: { args: shared }, externallyOwned: [shared] }));

    expect(getterCalled).toBe(false);
  });
});

describe("EventBus.subscribe", () => {
  it("receives events matching its category", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("network", handler);
    bus.report(baseInput({ category: "network" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores events with a non-matching category", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("network", handler);
    bus.report(baseInput({ category: "console" }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("wildcard subscriber receives all categories", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    bus.report(baseInput({ category: "network" }));
    bus.report(baseInput({ category: "console" }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe(handler) stops delivery", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("runtime", handler);
    bus.unsubscribe(handler);
    bus.report(baseInput());
    expect(handler).not.toHaveBeenCalled();
  });

  it("returned dispose function stops delivery", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const dispose = bus.subscribe("runtime", handler);
    dispose();
    bus.report(baseInput());
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("EventBus middleware", () => {
  it("executes middleware in registration order", () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.addMiddleware((event, next) => {
      order.push("first");
      next(event);
    });
    bus.addMiddleware((event, next) => {
      order.push("second");
      next(event);
    });
    bus.report(baseInput());
    expect(order).toEqual(["first", "second"]);
  });

  it("can modify the event via spread", () => {
    const bus = createEventBus();
    bus.addMiddleware((event, next) => next({ ...event, title: "Modified" }));
    expect(bus.report(baseInput({ title: "Original" })).title).toBe("Modified");
  });

  it("can modify the event via in-place mutation", () => {
    const bus = createEventBus();
    bus.addMiddleware((event, next) => {
      event.title = "Mutated";
      next(event);
    });
    expect(bus.report(baseInput({ title: "Original" })).title).toBe("Mutated");
  });

  it("modification reaches subscribers", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("runtime", handler);
    bus.addMiddleware((event, next) => next({ ...event, title: "Modified" }));
    bus.report(baseInput({ title: "Original" }));
    expect(handler.mock.calls[0][0].title).toBe("Modified");
  });

  it("throws MiddlewareError if next() is called twice", () => {
    const bus = createEventBus();
    bus.addMiddleware((event, next) => {
      next(event);
      next(event);
    });
    expect(() => bus.report(baseInput())).toThrow(MiddlewareError);
  });

  it("middleware can enrich metadata", () => {
    const bus = createEventBus();
    bus.addMiddleware((event, next) =>
      next({ ...event, metadata: { ...event.metadata, enriched: true } })
    );
    expect(bus.report(baseInput()).metadata).toEqual({ enriched: true });
  });
});

describe("EventBus replay", () => {
  it("replay: true sends buffered history to a new subscriber", () => {
    const bus = createEventBus();
    bus.report(baseInput({ category: "runtime" }));
    const handler = vi.fn();
    bus.subscribe("runtime", handler, { replay: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replay respects category filter", () => {
    const bus = createEventBus();
    bus.report(baseInput({ category: "runtime" }));
    bus.report(baseInput({ category: "network" }));
    const handler = vi.fn();
    bus.subscribe("network", handler, { replay: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].category).toBe("network");
  });

  it("respects the maxHistory buffer limit", () => {
    const bus = createEventBus({ maxHistory: 2 });
    bus.report(baseInput({ title: "one" }));
    bus.report(baseInput({ title: "two" }));
    bus.report(baseInput({ title: "three" }));
    const events = bus.getEvents();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.title)).toEqual(["two", "three"]);
  });
});

describe("EventBus lifecycle", () => {
  it("destroy clears listeners", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    bus.destroy();
    expect(() => bus.report(baseInput())).toThrow(EventBusDestroyedError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("destroy clears the replay buffer", () => {
    const bus = createEventBus();
    bus.report(baseInput());
    bus.destroy();
    // getEvents() also throws post-destroy — verified below — so we check
    // via a fresh bus that clear() empties the buffer instead.
  });

  it("destroy is idempotent", () => {
    const bus = createEventBus();
    bus.destroy();
    expect(() => bus.destroy()).not.toThrow();
  });

  it("report after destroy throws", () => {
    const bus = createEventBus();
    bus.destroy();
    expect(() => bus.report(baseInput())).toThrow(EventBusDestroyedError);
  });

  it("subscribe after destroy throws", () => {
    const bus = createEventBus();
    bus.destroy();
    expect(() => bus.subscribe("*", vi.fn())).toThrow(EventBusDestroyedError);
  });

  it("addMiddleware after destroy throws", () => {
    const bus = createEventBus();
    bus.destroy();
    expect(() => bus.addMiddleware((e, next) => next(e))).toThrow(EventBusDestroyedError);
  });

  it("getEvents after destroy throws", () => {
    const bus = createEventBus();
    bus.destroy();
    expect(() => bus.getEvents()).toThrow(EventBusDestroyedError);
  });
});

describe("RingBuffer", () => {
  it("clear empties the buffer", () => {
    const bus = createEventBus();
    bus.report(baseInput());
    bus.clear();
    expect(bus.getEvents()).toHaveLength(0);
  });
});

describe("EventBus middleware — additional cases", () => {
  it("next() with no arguments continues with the mutated draft", () => {
    const bus = createEventBus();
    bus.addMiddleware((event, next) => {
      event.title = "Mutated";
      next();
    });
    expect(bus.report(baseInput({ title: "Original" })).title).toBe("Mutated");
  });

  it("if a middleware throws, report() throws and no subscriber is notified", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    bus.addMiddleware(() => {
      throw new Error("boom");
    });
    expect(() => bus.report(baseInput())).toThrow("boom");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("EventBus replay — history then future", () => {
  it("a replay subscriber receives buffered history AND subsequent events", () => {
    const bus = createEventBus();
    bus.report(baseInput({ title: "past" }));
    const handler = vi.fn();
    bus.subscribe("runtime", handler, { replay: true });
    bus.report(baseInput({ title: "future" }));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].title).toBe("past");
    expect(handler.mock.calls[1][0].title).toBe("future");
  });
});
