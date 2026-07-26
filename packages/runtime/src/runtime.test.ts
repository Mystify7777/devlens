// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventBus } from "@devlens/core";
import { createRuntimePlugin } from "./runtime";
import { normalizeErrorEvent, normalizeUnhandledRejection } from "./normalizers/runtime-normalizer";

describe("normalizeErrorEvent", () => {
  it("preserves message and filename/line/col in context", () => {
    const result = normalizeErrorEvent({
      message: "Something broke",
      filename: "app.js",
      lineno: 10,
      colno: 5,
    });
    expect(result.message).toBe("Something broke");
    expect(result.context).toEqual({ filename: "app.js", lineno: 10, colno: 5 });
  });

  it("preserves stack when a real Error is attached", () => {
    const err = new Error("boom");
    const result = normalizeErrorEvent({ message: "boom", error: err });
    expect(result.stack).toBe(err.stack);
  });

  it("has no stack when error is not a real Error instance", () => {
    const result = normalizeErrorEvent({ message: "boom" });
    expect(result.stack).toBeUndefined();
  });
});

describe("normalizeUnhandledRejection", () => {
  it("handles a rejected Error", () => {
    const err = new Error("rejected");
    const result = normalizeUnhandledRejection({ reason: err });
    expect(result.message).toBe("rejected");
    expect(result.stack).toBe(err.stack);
  });

  it("handles a rejected string", () => {
    const result = normalizeUnhandledRejection({ reason: "plain string reason" });
    expect(result.message).toBe("plain string reason");
  });

  it("handles a rejected arbitrary object", () => {
    const result = normalizeUnhandledRejection({ reason: { code: 500 } });
    expect(result.message).toBe(JSON.stringify({ code: 500 }));
  });
});

describe("RuntimePlugin lifecycle", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
  });

  it("install() registers both listeners", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });

  it("calling install() twice does not register listeners twice", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    runtime.install();
    const errorCalls = addSpy.mock.calls.filter((c) => c[0] === "error");
    expect(errorCalls).toHaveLength(1);
  });

  it("uninstall() removes both listeners", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    runtime.uninstall();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });

  it("calling uninstall() when not installed is a no-op", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    expect(() => runtime.uninstall()).not.toThrow();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("calling uninstall() twice in a row does not throw", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    runtime.uninstall();
    expect(() => runtime.uninstall()).not.toThrow();
  });

  it("install -> uninstall -> install works and only registers once per install", () => {
    const bus = createEventBus();
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    runtime.uninstall();
    runtime.install();
    const errorCalls = addSpy.mock.calls.filter((c) => c[0] === "error");
    expect(errorCalls).toHaveLength(2); // once per real install
  });
});

describe("RuntimePlugin end-to-end via real window events", () => {
  it("reports a runtime event when a window 'error' event fires", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("runtime", handler);
    const runtime = createRuntimePlugin(bus);
    runtime.install();

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Uncaught TypeError: boom",
        filename: "app.js",
        lineno: 1,
        colno: 1,
      })
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe("Uncaught TypeError: boom");
    expect(handler.mock.calls[0][0].category).toBe("runtime");

    runtime.uninstall();
  });

  it("stops reporting after uninstall", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("runtime", handler);
    const runtime = createRuntimePlugin(bus);
    runtime.install();
    runtime.uninstall();

    window.dispatchEvent(new ErrorEvent("error", { message: "should be ignored" }));

    expect(handler).not.toHaveBeenCalled();
  });
});