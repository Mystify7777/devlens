// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEventBus, createEventStore, connectStoreToBus } from "@devlens/core";
import { createNetworkPlugin } from "./network";

// Now that install() actually patches window.fetch (Step 3A) and
// XMLHttpRequest.prototype.open/send (Step 4B), every test in this
// file needs the real references saved and restored, regardless of
// what an individual test does — otherwise a test that calls
// install() without a matching uninstall() leaks a patched
// window.fetch or XMLHttpRequest.prototype into whatever test runs
// next in this file.
let realFetch: typeof fetch;
let realXhrOpen: typeof XMLHttpRequest.prototype.open;
let realXhrSend: typeof XMLHttpRequest.prototype.send;

beforeEach(() => {
  realFetch = window.fetch;
  realXhrOpen = XMLHttpRequest.prototype.open;
  realXhrSend = XMLHttpRequest.prototype.send;
});

afterEach(() => {
  window.fetch = realFetch;
  XMLHttpRequest.prototype.open = realXhrOpen;
  XMLHttpRequest.prototype.send = realXhrSend;
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

    expect(fakeOriginal).toHaveBeenCalledWith("https://api.example.com/users", { method: "POST" });
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
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

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
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

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
      const event = await captureOneEvent(async () => new Response(null, { status: 200 }));
      expect(event.category).toBe("network");
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "success", status: 200 });
    });

    it("fulfilled 404 -> http-error/warn", async () => {
      const event = await captureOneEvent(async () => new Response(null, { status: 404 }));
      expect(event.severity).toBe("warn");
      expect(event.metadata).toMatchObject({
        outcome: "http-error",
        status: 404,
      });
    });

    it("fulfilled 500 -> http-error/error", async () => {
      const event = await captureOneEvent(async () => new Response(null, { status: 500 }));
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
      const event = await captureOneEvent(() => Promise.reject(new TypeError("Failed to fetch")));
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

// Step 4B (ADR-0010, informed by docs/research/xhr-capture.md): the
// full XHR chain, wired together for real — same discipline as the
// Step 3C Fetch integration suite above. Every test here uses the
// real, patched XMLHttpRequest.prototype (via createNetworkPlugin's
// own install()), manually dispatching lifecycle events on a real
// instance rather than mocking XMLHttpRequest.prototype.open/send
// directly the way xhr-interceptor.test.ts does — this is what proves
// the interceptor, classifier, and normalizer are wired correctly
// together, not just individually correct.
describe("createNetworkPlugin end-to-end XHR reporting (Step 4B)", () => {
  // Unlike xhr-interceptor.test.ts's unit tests (which stub open/send
  // directly), these tests exercise createNetworkPlugin's own
  // install(), which wraps whatever XMLHttpRequest.prototype.open/send
  // actually are at that moment. Left unstubbed, jsdom's real send()
  // attempts a genuine network request — observed directly (real DNS
  // lookups against api.example.com failing, logged to stderr) before
  // this fix. Stubbing the true originals to inert fakes here, before
  // install() runs, is what fetch's own equivalent integration tests
  // get for free from window.fetch resolving to a real implementation
  // that at least doesn't block on jsdom's separate XHR machinery —
  // XHR has no such free pass.
  beforeEach(() => {
    XMLHttpRequest.prototype.open = vi.fn();
    XMLHttpRequest.prototype.send = vi.fn();
  });

  function setStatus(xhr: XMLHttpRequest, status: number): void {
    Object.defineProperty(xhr, "status", { value: status, configurable: true });
  }

  it("reports exactly one event for a successful async XHR request", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    setStatus(xhr, 200);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(1);

    network.uninstall();
  });

  it("reports no event when open() happens but send() never does", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(0);

    network.uninstall();
  });

  it("does not report anything before install()", () => {
    const bus = createEventBus();
    createNetworkPlugin(bus); // never installed

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(0);
  });

  it("stops reporting after uninstall()", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();
    network.uninstall();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(0);
  });

  it("reports one event per completed request when an XHR instance is reused sequentially", () => {
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/a");
    xhr.send();
    setStatus(xhr, 200);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    xhr.open("POST", "https://api.example.com/b");
    xhr.send();
    setStatus(xhr, 201);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(2);
    expect(bus.getEvents()[0].metadata).toMatchObject({
      url: "https://api.example.com/a",
    });
    expect(bus.getEvents()[1].metadata).toMatchObject({
      url: "https://api.example.com/b",
    });

    network.uninstall();
  });

  it("does not misattribute a later open() call's metadata to an in-flight request's reported event", () => {
    // The mandatory reuse-hazard test, at the full end-to-end level —
    // xhr-interceptor.test.ts already proves this at the interceptor
    // layer directly; this proves it survives all the way through
    // classification, normalization, and the real Bus.
    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/a");
    xhr.send();

    xhr.open("POST", "https://api.example.com/b"); // never sent

    setStatus(xhr, 200);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(bus.getEvents()).toHaveLength(1);
    expect(bus.getEvents()[0].metadata).toMatchObject({
      method: "GET",
      url: "https://api.example.com/a",
    });

    network.uninstall();
  });

  describe("classification reaches the reported event correctly, for every XHR outcome", () => {
    function captureOneEvent(
      settle: (xhr: XMLHttpRequest) => void,
      url = "https://api.example.com/users"
    ) {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.send();
      settle(xhr);

      network.uninstall();
      return bus.getEvents()[0];
    }

    it("load, 200 -> success/info", () => {
      const event = captureOneEvent((xhr) => {
        setStatus(xhr, 200);
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.category).toBe("network");
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "success", status: 200 });
    });

    it("load, 404 -> http-error/warn", () => {
      const event = captureOneEvent((xhr) => {
        setStatus(xhr, 404);
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.severity).toBe("warn");
      expect(event.metadata).toMatchObject({
        outcome: "http-error",
        status: 404,
      });
    });

    it("load, 500 -> http-error/error", () => {
      const event = captureOneEvent((xhr) => {
        setStatus(xhr, 500);
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.severity).toBe("error");
      expect(event.metadata).toMatchObject({
        outcome: "http-error",
        status: 500,
      });
    });

    it("abort -> aborted/info, status reported as null", () => {
      const event = captureOneEvent((xhr) => {
        xhr.dispatchEvent(new Event("abort"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.severity).toBe("info");
      expect(event.metadata).toMatchObject({ outcome: "aborted", status: null });
    });

    it("timeout -> timeout/warn, status reported as null", () => {
      const event = captureOneEvent((xhr) => {
        xhr.dispatchEvent(new Event("timeout"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.severity).toBe("warn");
      expect(event.metadata).toMatchObject({ outcome: "timeout", status: null });
    });

    it("error -> network-error/error, status reported as null", () => {
      const event = captureOneEvent((xhr) => {
        xhr.dispatchEvent(new Event("error"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.severity).toBe("error");
      expect(event.metadata).toMatchObject({
        outcome: "network-error",
        status: null,
      });
    });

    it("carries the measured duration and the original method/URL through to the reported event", () => {
      vi.spyOn(performance, "now").mockReturnValueOnce(2000).mockReturnValueOnce(2060);
      const event = captureOneEvent((xhr) => {
        setStatus(xhr, 200);
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      }, "https://api.example.com/orders");

      expect(event.metadata).toMatchObject({
        method: "POST",
        url: "https://api.example.com/orders",
        duration: 60,
      });
      expect(event.title).toBe("POST https://api.example.com/orders");

      vi.restoreAllMocks();
    });

    it("tags the event's origin as 'xhr', distinguishing it from Fetch-sourced events", () => {
      const event = captureOneEvent((xhr) => {
        setStatus(xhr, 200);
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      });
      expect(event.origin).toBe("xhr");
    });
  });
});

// v0.5.2 Network Integration milestone: every prior test in this file
// asserts against a bare EventBus (bus.getEvents()), matching how
// Fetch/XHR classification and reporting were originally built and
// verified in isolation. Nothing above ever exercises the second half
// of Network's real production path — connectStoreToBus() and a real
// EventStore — the same path apps/playground/main.ts actually wires
// together (Runtime and Console already have no dedicated test for
// this either; Network gets one here specifically because the v0.5.2
// milestone's own investigation flagged the absence of any
// Network-to-Store composition coverage). This is intentionally the
// smallest possible test proving the seam works, not a duplicate of
// the classification/lifecycle coverage above.
describe("createNetworkPlugin composed with EventStore (v0.5.2)", () => {
  it('a captured Fetch request reaches a connected EventStore, tagged with category "network"', async () => {
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

    const bus = createEventBus();
    const store = createEventStore();
    connectStoreToBus(bus, store);
    const network = createNetworkPlugin(bus);
    network.install();

    await window.fetch("https://api.example.com/users");

    const events = store.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("network");
    expect(events[0].origin).toBe("fetch");
  });
});

// v0.5.2 Network Integration milestone: reproduces the exact
// composition apps/playground/main.ts uses —
// bus.subscribe("*", event => console.table(event)) — with a
// Network-originated event as the trigger, rather than a
// Runtime/Console-originated one (which is all any existing test in
// the repo covers).
//
// This deliberately does NOT install @devlens/console. That is not a
// gap: Console's own METHODS list (packages/console/src/console.ts)
// intercepts only log/info/debug/warn/error — "table" is confirmed
// absent from it, and grepping the whole @devlens/console package
// source for "table" finds no reference at all. console.table is
// therefore never touched by Console's interceptor regardless of
// whether Console is installed, so Console's install state cannot
// affect this composition's behavior one way or the other. Adding
// @devlens/console as a dependency of @devlens/network purely to
// install a plugin whose presence provably changes nothing here would
// be a new, unjustified cross-capture-package edge — something no
// existing test in this repo does (every test file only ever imports
// @devlens/core alongside the package under test). This test verifies
// the composition precisely as it actually needs to be verified,
// without introducing that edge.
describe('Playground-style bus.subscribe("*") → console.table() composition (v0.5.2)', () => {
  it("a Network-originated event reaches a wildcard subscriber and is printed with console.table()", async () => {
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

    const realTable = console.table;
    const tableSpy = vi.fn();
    console.table = tableSpy;

    try {
      const bus = createEventBus();
      const store = createEventStore();
      connectStoreToBus(bus, store);
      const network = createNetworkPlugin(bus);
      network.install();

      bus.subscribe("*", (event) => {
        console.table(event);
      });

      await window.fetch("https://api.example.com/orders");

      // Exactly one Network event was ever reported — the subscriber's
      // own console.table() call must not have triggered a second,
      // recursive report (it can't, since Network's interceptor patches
      // fetch/XHR, not console.table — but this is the same
      // "exactly once" shape every other reentrancy-adjacent test in
      // this suite uses, applied to this composition specifically).
      expect(store.getAll()).toHaveLength(1);
      expect(tableSpy).toHaveBeenCalledTimes(1);
      expect(tableSpy.mock.calls[0][0].category).toBe("network");
    } finally {
      // Restored unconditionally, even if an assertion above throws —
      // otherwise a failing assertion would leave the real
      // console.table permanently replaced for every test that runs
      // after this one in the same process.
      console.table = realTable;
    }
  });
});
