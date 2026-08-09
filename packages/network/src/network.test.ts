// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEventBus } from "@devlens/core";
import { createNetworkPlugin } from "./network";

// Now that install() actually patches window.fetch (Step 3A), every
// test in this file needs the real reference saved and restored,
// regardless of what an individual test does — otherwise a test that
// calls install() without a matching uninstall() leaks a patched
// window.fetch into whatever test runs next in this file.
let realFetch: typeof fetch;

beforeEach(() => {
  realFetch = window.fetch;
});

afterEach(() => {
  window.fetch = realFetch;
});

// Phase 0.5 (ADR-0010): the package surface is locked before any
// interception logic exists. These tests prove the lifecycle contract
// itself — install()/uninstall() are callable, idempotent, and
// reinstallable — the same shape Runtime and Console's own lifecycle
// tests prove, independent of what install() actually intercepts.
describe("createNetworkPlugin lifecycle", () => {
  it("install() is callable and does not throw", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    expect(() => network.install()).not.toThrow();
  });

  it("calling install() twice does not throw", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();
    expect(() => network.install()).not.toThrow();
  });

  it("uninstall() is callable and does not throw", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();
    expect(() => network.uninstall()).not.toThrow();
  });

  it("calling uninstall() when not installed is a no-op", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    expect(() => network.uninstall()).not.toThrow();
  });

  it("calling uninstall() twice in a row does not throw", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();
    network.uninstall();
    expect(() => network.uninstall()).not.toThrow();
  });

  it("install -> uninstall -> install works without throwing", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    expect(() => {
      network.install();
      network.uninstall();
      network.install();
    }).not.toThrow();
  });
});

// Step 3A (ADR-0010): interception only. Every test here injects its
// own fake `window.fetch` rather than trusting the ambient one — in
// this environment window.fetch resolves to Node's real, native
// fetch (vitest's jsdom environment aliases window to globalThis), and
// letting a real fetch run in a test would mean an actual, unwanted
// network call.
describe("createNetworkPlugin fetch interception (Step 3A)", () => {
  it("replaces window.fetch with an interceptor on install()", () => {
    const fakeOriginal = vi.fn(async () => new Response());
    window.fetch = fakeOriginal as unknown as typeof fetch;

    const network = createNetworkPlugin(createEventBus());
    network.install();

    expect(window.fetch).not.toBe(fakeOriginal);
  });

  it("the installed fetch delegates to the fake original with the same arguments", async () => {
    const fakeOriginal = vi.fn(async () => new Response());
    window.fetch = fakeOriginal as unknown as typeof fetch;

    const network = createNetworkPlugin(createEventBus());
    network.install();

    await window.fetch("https://api.example.com/users", { method: "POST" });

    expect(fakeOriginal).toHaveBeenCalledWith(
      "https://api.example.com/users",
      { method: "POST" }
    );
  });

  it("restores the exact original fetch reference on uninstall()", () => {
    const fakeOriginal = vi.fn(async () => new Response());
    window.fetch = fakeOriginal as unknown as typeof fetch;

    const network = createNetworkPlugin(createEventBus());
    network.install();
    network.uninstall();

    expect(window.fetch).toBe(fakeOriginal);
  });

  it("does not double-wrap when install() is called twice", async () => {
    const fakeOriginal = vi.fn(async () => new Response());
    window.fetch = fakeOriginal as unknown as typeof fetch;

    const network = createNetworkPlugin(createEventBus());
    network.install();
    network.install();

    await window.fetch("https://api.example.com/users");

    expect(fakeOriginal).toHaveBeenCalledTimes(1);
  });

  it("does not throw and leaves fetch untouched if window.fetch is not a function", () => {
    // @ts-expect-error deliberately simulating an environment without fetch
    window.fetch = undefined;

    const network = createNetworkPlugin(createEventBus());
    expect(() => network.install()).not.toThrow();
    expect(window.fetch).toBeUndefined();
  });
});

// Step 3C (ADR-0010): the full chain, wired together for real —
// fetch -> interceptor -> classifier -> CapturedRequest -> normalizer
// -> bus.report(). Proves the seams weren't individually correct but
// mutually incompatible, which unit tests of each piece in isolation
// (the earlier describe blocks in this file, plus
// fetch-outcome.test.ts and network-normalizer.test.ts) cannot prove
// on their own.
describe("createNetworkPlugin end-to-end fetch reporting (Step 3C)", () => {
  it("reports exactly one event for a fulfilled request", async () => {
    window.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    await window.fetch("https://api.example.com/users");

    expect(bus.getEvents()).toHaveLength(1);
  });

  it("reports exactly one event for a rejected request", async () => {
    window.fetch = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    ) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    await window.fetch("https://api.example.com/users").catch(() => {
      // the caller's own rejection — irrelevant to this assertion,
      // just needs to be handled so it isn't an unhandled rejection
      // in the test itself.
    });

    expect(bus.getEvents()).toHaveLength(1);
  });

  it("reports no event when the original fetch throws synchronously", () => {
    window.fetch = vi.fn(() => {
      throw new Error("thrown synchronously by a wrapped original");
    }) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    expect(() => window.fetch("https://api.example.com/users")).toThrow();
    expect(bus.getEvents()).toHaveLength(0);
  });

  it("does not report anything before install()", async () => {
    const fakeOriginal = vi.fn(async () => new Response(null, { status: 200 }));
    window.fetch = fakeOriginal as unknown as typeof fetch;

    const bus = createEventBus();
    createNetworkPlugin(bus); // never installed

    await window.fetch("https://api.example.com/users");

    expect(bus.getEvents()).toHaveLength(0);
  });

  it("stops reporting after uninstall()", async () => {
    window.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();
    network.uninstall();

    await window.fetch("https://api.example.com/users");

    expect(bus.getEvents()).toHaveLength(0);
  });

  describe("classification reaches the reported event correctly, for every outcome", () => {
    async function captureOneEvent(
      fakeOriginal: () => ReturnType<typeof fetch>,
      url = "https://api.example.com/users"
    ) {
      window.fetch = vi.fn(fakeOriginal) as unknown as typeof fetch;
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch(url, { method: "POST" }).catch(() => {
        // rejections are expected in several of the cases below;
        // irrelevant to what's asserted, just needs to be handled.
      });

      return bus.getEvents()[0];
    }

    it("fulfilled 200 -> success/info", async () => {
      const event = await captureOneEvent(
        async () => new Response(null, { status: 200 })
      );
      expect(event.category).toBe("network");
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "success", status: 200 });
    });

    it("fulfilled 404 -> http-error/warn", async () => {
      const event = await captureOneEvent(
        async () => new Response(null, { status: 404 })
      );
      expect(event.severity).toBe("warn");
      expect(event.metadata).toMatchObject({
        outcome: "http-error",
        status: 404,
      });
    });

    it("fulfilled 500 -> http-error/error", async () => {
      const event = await captureOneEvent(
        async () => new Response(null, { status: 500 })
      );
      expect(event.severity).toBe("error");
      expect(event.metadata).toMatchObject({
        outcome: "http-error",
        status: 500,
      });
    });

    it("fulfilled opaque response -> opaque/info", async () => {
      const event = await captureOneEvent(async () => {
        const response = new Response(null, { status: 200 });
        Object.defineProperty(response, "status", { value: 0 });
        Object.defineProperty(response, "type", { value: "opaque" });
        return response;
      });
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "opaque", status: 0 });
    });

    it("rejected AbortError -> aborted/info", async () => {
      const event = await captureOneEvent(() =>
        Promise.reject(new DOMException("The user aborted a request.", "AbortError"))
      );
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "aborted", status: null });
    });

    it("rejected TimeoutError -> timeout/warn", async () => {
      const event = await captureOneEvent(() =>
        Promise.reject(new DOMException("The signal timed out", "TimeoutError"))
      );
      expect(event.severity).toBe("warn");
      expect(event.metadata).toMatchObject({ outcome: "timeout", status: null });
    });

    it("rejected with an arbitrary error -> network-error/error", async () => {
      const event = await captureOneEvent(() =>
        Promise.reject(new TypeError("Failed to fetch"))
      );
      expect(event.severity).toBe("error");
      expect(event.metadata).toMatchObject({
        outcome: "network-error",
        status: null,
      });
    });

    it("carries the measured duration and the original method/URL through to the reported event", async () => {
      vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1075);
      const event = await captureOneEvent(
        async () => new Response(null, { status: 200 }),
        "https://api.example.com/orders"
      );

      expect(event.metadata).toMatchObject({
        method: "POST",
        url: "https://api.example.com/orders",
        duration: 75,
      });
      expect(event.title).toBe("POST https://api.example.com/orders");

      vi.restoreAllMocks();
    });
  });
});
