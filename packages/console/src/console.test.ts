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