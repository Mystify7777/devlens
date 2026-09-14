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
//
// Issue #17 / ADR-0010 amendment: normalizeCapturedUrl() is unit-
// tested exhaustively in normalize-url.test.ts. These tests exist to
// prove it's actually wired into the real end-to-end path for both
// capture mechanisms — that a query token doesn't survive all the way
// out to a reported event's metadata.url, not just that the pure
// function itself redacts it in isolation.
describe("createNetworkPlugin end-to-end URL redaction and normalization (Issue #17)", () => {
  it("redacts a query token in a reported fetch event's metadata.url and title", async () => {
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    await window.fetch("https://api.example.com/login?token=abc123");

    const event = bus.getEvents()[0];
    expect(event.metadata).toMatchObject({ url: "https://api.example.com/login?token=***" });
    expect(event.title).toContain("token=***");
    expect(event.title).not.toContain("abc123");

    network.uninstall();
  });

  it("strips a fragment and omits the default port in a reported fetch event", async () => {
    window.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;

    const bus = createEventBus();
    const network = createNetworkPlugin(bus);
    network.install();

    await window.fetch("https://api.example.com:443/users#section-2");

    expect(bus.getEvents()[0].metadata).toMatchObject({
      url: "https://api.example.com/users",
    });

    network.uninstall();
  });

  describe("XHR path", () => {
    beforeEach(() => {
      XMLHttpRequest.prototype.open = vi.fn();
      XMLHttpRequest.prototype.send = vi.fn();
    });

    function setStatus(xhr: XMLHttpRequest, status: number): void {
      Object.defineProperty(xhr, "status", { value: status, configurable: true });
    }

    it("redacts a query token in a reported XHR event's metadata.url", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/login?token=abc123");
      xhr.send();
      setStatus(xhr, 200);
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        url: "https://api.example.com/login?token=***",
      });

      network.uninstall();
    });
  });
});

// Issue #18 / ADR-0010 amendment: contentType/contentLength.
// normalize-url.test.ts and parse-content-length.test.ts already
// exhaustively unit-test URL redaction and Content-Length parsing in
// isolation. These tests exist to prove both are actually wired into
// the real end-to-end path for both capture mechanisms, matching the
// same reasoning the Issue #17 block above already established.
describe("createNetworkPlugin end-to-end response metadata (Issue #18)", () => {
  describe("Fetch path", () => {
    it("captures Content-Type and Content-Length when both are present, preserving Content-Type parameters raw", async () => {
      // Uses a charset parameter deliberately (not a bare
      // "application/json") to verify the raw-value contract at the
      // integration level, not just assert it in the ADR: the full
      // header value survives unparsed, unnormalized, exactly as the
      // response supplied it.
      window.fetch = vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": "42",
            },
          })
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users");

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: "application/json; charset=utf-8",
        contentLength: 42,
      });

      network.uninstall();
    });

    it("captures Content-Length: 0 as the number 0, not null", async () => {
      // The explicit regression guard every reviewer asked for by
      // name — not folded into the "both present" test above, so a
      // truthy-check regression can't hide inside a generic assertion.
      // Deliberately an ordinary 200, not 204 — this is about "0" being
      // a valid Content-Length value on any response with an empty
      // body, not about any particular status code's own semantics.
      window.fetch = vi.fn(
        async () => new Response(null, { status: 200, headers: { "Content-Length": "0" } })
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users");

      expect(bus.getEvents()[0].metadata?.contentLength).toBe(0);

      network.uninstall();
    });

    it("reports null for contentLength when the header is present but malformed, confirming the parser is actually wired in here", async () => {
      // parse-content-length.test.ts already exhaustively covers the
      // parser's own rejection rules in isolation. This exists to
      // confirm parseContentLength() is actually invoked at this real
      // extraction site, not just correct in isolation — a
      // comma-joined value is used here specifically since it's one
      // of the more realistic ways a malformed value could appear
      // (multiple same-name headers collapsed by the browser into one
      // string), not an arbitrary/unrealistic garbage string.
      window.fetch = vi.fn(
        async () => new Response(null, { status: 200, headers: { "Content-Length": "123, 456" } })
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users");

      expect(bus.getEvents()[0].metadata?.contentLength).toBeNull();

      network.uninstall();
    });

    it("reports null for both fields when neither header is present", async () => {
      window.fetch = vi.fn(
        async () => new Response(null, { status: 200 })
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users");

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("reports null for both fields on a simulated opaque-response shape (this environment cannot construct a genuine opaque Response)", async () => {
      window.fetch = vi.fn(async () => {
        // This does NOT validate the browser's own opaque-response
        // filtering mechanism — that filtering happens inside the
        // real fetch algorithm when handling a no-cors cross-origin
        // request, which cannot be triggered or reproduced in this
        // test environment. Same simulation approach
        // fetch-outcome.test.ts already uses: this constructs only
        // the *observable shape* a genuine opaque Response has
        // (status 0, type "opaque", and — critically for this test —
        // no headers were ever added to this Response literal,
        // matching a real opaque response's empty, immutable headers)
        // and confirms DevLens's own extraction code handles that
        // shape correctly. It does not and cannot confirm the browser
        // actually produces that shape correctly — that's the
        // platform's contract, not this package's.
        const response = new Response(null, { status: 200 });
        Object.defineProperty(response, "status", { value: 0 });
        Object.defineProperty(response, "type", { value: "opaque" });
        return response;
      }) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/tracking-pixel");

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("reports null for both fields when the request is rejected (no response at all)", async () => {
      window.fetch = vi.fn(() =>
        Promise.reject(new TypeError("Failed to fetch"))
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users").catch(() => {
        // the caller's own rejection — irrelevant to this assertion.
      });

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("still captures metadata on an HTTP error response (404) — failure and metadata availability are independent", async () => {
      window.fetch = vi.fn(
        async () =>
          new Response(null, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", "Content-Length": "88" },
          })
      ) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/users/999");

      expect(bus.getEvents()[0].metadata).toMatchObject({
        outcome: "http-error",
        contentType: "application/problem+json",
        contentLength: 88,
      });

      network.uninstall();
    });

    it("reads metadata from whatever Response fetch() resolves with, with no separate redirect-hop handling", async () => {
      // This does NOT exercise a real redirect chain — window.fetch is
      // fully mocked here (as in every test in this file), so no
      // actual browser redirect-following algorithm ever runs. What
      // this confirms is narrower and accurate to what's actually
      // testable in this environment: extraction reads whatever
      // Response object it's given — the `redirected`/`url`
      // properties below are set only to make the shape resemble what
      // a real post-redirect Response looks like, they are not
      // exercised by anything under test. The production contract
      // this documents is that fetch()'s own resolved Response
      // (which, with the default redirect: "follow", already IS the
      // final response after any real redirects) is read as-is — no
      // redirect-hop reporting is introduced or attempted by DevLens.
      window.fetch = vi.fn(async () => {
        const response = new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/html", "Content-Length": "10" },
        });
        Object.defineProperty(response, "redirected", { value: true });
        Object.defineProperty(response, "url", {
          value: "https://api.example.com/final-destination",
        });
        return response;
      }) as unknown as typeof fetch;

      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      await window.fetch("https://api.example.com/original-link");

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: "text/html",
        contentLength: 10,
      });

      network.uninstall();
    });
  });

  describe("XHR path", () => {
    beforeEach(() => {
      XMLHttpRequest.prototype.open = vi.fn();
      XMLHttpRequest.prototype.send = vi.fn();
    });

    function setStatus(xhr: XMLHttpRequest, status: number): void {
      Object.defineProperty(xhr, "status", { value: status, configurable: true });
    }

    function stubResponseHeaders(xhr: XMLHttpRequest, headers: Record<string, string>): void {
      xhr.getResponseHeader = vi.fn(
        (name: string) => headers[name] ?? null
      ) as typeof xhr.getResponseHeader;
    }

    it("captures Content-Type and Content-Length when both are present", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      setStatus(xhr, 200);
      stubResponseHeaders(xhr, { "Content-Type": "application/json", "Content-Length": "42" });
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: "application/json",
        contentLength: 42,
      });

      network.uninstall();
    });

    it("captures Content-Length: 0 as the number 0, not null", () => {
      // Deliberately an ordinary 200 — see the matching Fetch test's
      // comment above for why 204 specifically was avoided here.
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      setStatus(xhr, 200);
      stubResponseHeaders(xhr, { "Content-Length": "0" });
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata?.contentLength).toBe(0);

      network.uninstall();
    });

    it("reports null for contentLength when the header is present but malformed, confirming the parser is actually wired in here", () => {
      // Same purpose as the matching Fetch test above: confirm
      // parseContentLength() is actually invoked at this extraction
      // site, not just correct in isolation.
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      setStatus(xhr, 200);
      stubResponseHeaders(xhr, { "Content-Length": "123, 456" });
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata?.contentLength).toBeNull();

      network.uninstall();
    });

    it("reports null for both fields when neither header is present", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      setStatus(xhr, 200);
      stubResponseHeaders(xhr, {});
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("reports null for both fields on a synthetic error event (no opaque-equivalent case exists for XHR)", () => {
      // Same caveat as the opaque-response test above: open()/send()
      // are stubbed no-ops (see this describe block's beforeEach), so
      // no real network attempt ever happens here. This dispatches a
      // synthetic "error" Event directly, simulating only the
      // observable shape a genuine network failure produces at the
      // loadend handler — it does not and cannot exercise an actual
      // DNS failure, connection refusal, or any other real-world cause
      // of an XHR error event.
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      stubResponseHeaders(xhr, {});
      xhr.dispatchEvent(new Event("error"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("reports null for both fields on abort", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      stubResponseHeaders(xhr, {});
      xhr.dispatchEvent(new Event("abort"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("reports null for both fields on timeout", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users");
      xhr.send();
      stubResponseHeaders(xhr, {});
      xhr.dispatchEvent(new Event("timeout"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        contentType: null,
        contentLength: null,
      });

      network.uninstall();
    });

    it("still captures metadata on an HTTP error response (404) — failure and metadata availability are independent", () => {
      const bus = createEventBus();
      const network = createNetworkPlugin(bus);
      network.install();

      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.example.com/users/999");
      xhr.send();
      setStatus(xhr, 404);
      stubResponseHeaders(xhr, {
        "Content-Type": "application/problem+json",
        "Content-Length": "88",
      });
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));

      expect(bus.getEvents()[0].metadata).toMatchObject({
        outcome: "http-error",
        contentType: "application/problem+json",
        contentLength: 88,
      });

      network.uninstall();
    });
  });
});

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
