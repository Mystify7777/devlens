import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "@devlens/core";
import { createConsolePlugin } from "./console";

describe("ConsolePlugin lifecycle", () => {
  it("install() replaces console methods", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    const before = console.log;
    plugin.install();
    expect(console.log).not.toBe(before);
    plugin.uninstall();
  });

  it("calling install() twice does not double-wrap", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();
    const wrappedOnce = console.log;
    plugin.install();
    expect(console.log).toBe(wrappedOnce);
    plugin.uninstall();
  });

  it("uninstall() restores the exact original methods", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    const before = console.log;
    plugin.install();
    plugin.uninstall();
    expect(console.log).toBe(before);
  });

  it("calling uninstall() when not installed is a no-op", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    const before = console.log;
    expect(() => plugin.uninstall()).not.toThrow();
    expect(console.log).toBe(before);
  });

  it("install -> uninstall -> install works correctly", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    const before = console.log;
    plugin.install();
    plugin.uninstall();
    plugin.install();
    expect(console.log).not.toBe(before);
    plugin.uninstall();
    expect(console.log).toBe(before);
  });
});

describe("ConsolePlugin preservation", () => {
  it("the original console implementation still executes for every intercepted call", () => {
    const bus = createEventBus();
    const realLog = console.log;
    const spy = vi.fn();
    console.log = spy; // simulate whatever was assigned before install()

    const plugin = createConsolePlugin(bus);
    plugin.install();
    console.log("hello");
    plugin.uninstall();

    expect(spy).toHaveBeenCalledWith("hello");
    console.log = realLog;
  });
});

// Issue #19 / ADR-0007's amendment: reporting a Console event must not
// freeze, or otherwise interfere with, objects the caller still holds
// live references to. This can only be observed through the real
// EventBus.report() pipeline (freezing happens there, not in the
// normalizer), which is why these live at this integration level
// rather than in console-normalizer.test.ts's pure-function tests.
describe("ConsolePlugin non-interference with caller-owned arguments", () => {
  it("does not freeze a plain object argument", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const userObject = { name: "Ann" };
    console.log("logging in", userObject);
    plugin.uninstall();

    expect(Object.isFrozen(userObject)).toBe(false);
  });

  it("does not freeze an object nested inside a logged argument", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const userObject = { name: "Ann", address: { city: "Springfield" } };
    console.log(userObject);
    plugin.uninstall();

    expect(Object.isFrozen(userObject.address)).toBe(false);
  });

  it("the caller can still mutate a logged object afterward — proves the actual bug is fixed, not just its symptom", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const userObject = { name: "Ann" };
    console.log("logging in", userObject);
    plugin.uninstall();

    expect(() => {
      userObject.name = "Bob";
    }).not.toThrow();
    expect(userObject.name).toBe("Bob");
  });

  it("Map, Set, and Date arguments all remain fully unaffected (regression — already true before this issue, worth pinning down explicitly for all three, not just one)", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const map = new Map([["retries", 3]]);
    const set = new Set([1, 2, 3]);
    const date = new Date(2024, 0, 1);
    const originalTime = date.getTime();

    console.log("config", map, set, date);
    plugin.uninstall();

    expect(Object.isFrozen(map)).toBe(false);
    expect(() => map.set("retries", 5)).not.toThrow();
    expect(map.get("retries")).toBe(5);

    expect(Object.isFrozen(set)).toBe(false);
    expect(() => set.add(4)).not.toThrow();
    expect(set.has(4)).toBe(true);

    expect(Object.isFrozen(date)).toBe(false);
    expect(() => date.setFullYear(2025)).not.toThrow();
    expect(date.getTime()).not.toBe(originalTime);
  });

  it("metadata.args remains a genuine array with the original element identities", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("console", handler);
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const userObject = { name: "Ann" };
    console.log("hello", userObject, 42);
    plugin.uninstall();

    const event = handler.mock.calls[0][0];
    const args = event.metadata.args;

    expect(Array.isArray(args)).toBe(true);
    expect(args).toHaveLength(3);
    expect(args[0]).toBe("hello");
    expect(args[1]).toBe(userObject); // same reference, not a copy
    expect(args[2]).toBe(42);
  });

  it("does not invoke a getter on a logged object — the production path for the same guarantee event-bus.test.ts pins down generically", () => {
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    plugin.install();

    let getterCalled = false;
    const objectWithGetter = {
      get dangerous() {
        getterCalled = true;
        return { value: 1 };
      },
    };

    // Deliberately NOT the first argument. describeFirstArg() (used to
    // build the event's `message` field) calls JSON.stringify() on
    // args[0] only — a separate, pre-existing code path that would
    // invoke a getter on its own, independent of deepFreeze, and has
    // nothing to do with the externallyOwned mechanism this test
    // exists to verify. Putting the getter-bearing object second
    // isolates the one thing actually under test: that
    // EventBus.report()'s freezing pass never touches it.
    console.log("logging an object", objectWithGetter);
    plugin.uninstall();

    expect(getterCalled).toBe(false);
  });
});

describe("ConsolePlugin event generation", () => {
  it("console.warn produces a matching DevLensEvent on the bus", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("console", handler);
    const plugin = createConsolePlugin(bus);
    plugin.install();

    console.warn("careful");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.category).toBe("console");
    expect(event.severity).toBe("warn");
    expect(event.origin).toBe("console.warn");
    expect(event.message).toBe("careful");

    plugin.uninstall();
  });

  it("console.error produces severity error with the full stack preserved", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("console", handler);
    const plugin = createConsolePlugin(bus);
    plugin.install();

    const err = new Error("boom");
    console.error(err);

    const event = handler.mock.calls[0][0];
    expect(event.severity).toBe("error");
    expect(event.message).toBe("boom");
    expect(event.stack).toBe(err.stack);

    plugin.uninstall();
  });
});

describe("ConsolePlugin stack from later arguments (Issue #22)", () => {
  it('console.error("failed", err) reports err.stack and still runs the original', () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    const bus = createEventBus();
    const plugin = createConsolePlugin(bus);
    const events: { stack?: string; message: string }[] = [];
    bus.subscribe("console", (e) => events.push(e));
    try {
      plugin.install();
      const err = new Error("boom");
      console.error("failed", err);
      expect(spy).toHaveBeenCalledWith("failed", err);
      expect(events).toHaveLength(1);
      expect(events[0].message).toBe("failed");
      expect(events[0].stack).toBe(err.stack);
    } finally {
      plugin.uninstall();
      console.error = original;
      bus.destroy();
    }
  });
});

describe("ConsolePlugin recursion guard", () => {
  it("a subscriber's console.log call prints normally but does not trigger a second report", () => {
    const bus = createEventBus();
    const realLog = console.log;
    const logSpy = vi.fn();
    console.log = logSpy;

    const plugin = createConsolePlugin(bus);

    let reportCount = 0;
    bus.subscribe("console", () => {
      reportCount++;
      console.log("inside subscriber");
    });

    plugin.install();
    console.error("boom");
    plugin.uninstall();

    console.log = realLog;

    // If the guard failed, this would recurse indefinitely (or at least
    // report more than once). Exactly 1 confirms the cycle was broken.
    expect(reportCount).toBe(1);
    // But the subscriber's console.log call must still have reached the
    // real logging call — the guard only blocks report(), never the
    // passthrough to the original method.
    expect(logSpy).toHaveBeenCalledWith("inside subscriber");
  });

  it("recursion guard resets after each top-level call, so subsequent independent calls still report", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("console", handler);

    const plugin = createConsolePlugin(bus);
    plugin.install();

    console.log("first");
    console.log("second");

    expect(handler).toHaveBeenCalledTimes(2);

    plugin.uninstall();
  });
});

describe("ConsolePlugin reinstall", () => {
  it("uninstall then reinstall leaves no stale wrappers — exactly one event per call", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("console", handler);

    const plugin = createConsolePlugin(bus);
    plugin.install();
    plugin.uninstall();
    plugin.install();

    console.log("after reinstall");

    expect(handler).toHaveBeenCalledTimes(1);

    plugin.uninstall();
  });
});
