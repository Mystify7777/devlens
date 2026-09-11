// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createFetchInterceptor } from "./fetch-interceptor";

describe("createFetchInterceptor", () => {
  it("calls the original with the exact same arguments", async () => {
    const original = vi.fn(async () => new Response());
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    await intercepted("https://api.example.com/users", { method: "POST" });

    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith("https://api.example.com/users", {
      method: "POST",
    });
  });

  it("returns the exact same promise the original returned — no derived/wrapped promise", () => {
    const originalPromise = Promise.resolve(new Response());
    const original = vi.fn(() => originalPromise);
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    const returned = intercepted("https://api.example.com/users");

    // Deliberately not `.toEqual` — this checks object identity, since
    // even a `.then(x => x)` passthrough would create a *new*, merely
    // equivalent promise. Step 3A must return the original instance.
    expect(returned).toBe(originalPromise);
  });

  it("resolves to the exact same Response instance the original resolved to", async () => {
    const fakeResponse = new Response();
    const original = vi.fn(async () => fakeResponse);
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    const result = await intercepted("https://api.example.com/users");

    expect(result).toBe(fakeResponse);
  });

  it("rejects with the exact same error the original rejected with", async () => {
    const theError = new TypeError("Failed to fetch");
    const original = vi.fn(() => Promise.reject(theError));
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    await expect(intercepted("https://api.example.com/users")).rejects.toBe(theError);
  });

  it("propagates a synchronous throw from the original synchronously, not as a rejection", () => {
    const syncError = new Error("thrown synchronously by a wrapped original");
    const original = vi.fn(() => {
      throw syncError;
    });
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    expect(() => intercepted("https://api.example.com/users")).toThrow(syncError);
  });

  it("forwards `this` to the original unchanged", async () => {
    let receivedThis: unknown;
    const original = function (this: unknown) {
      receivedThis = this;
      return Promise.resolve(new Response());
    };
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);
    const customThis = { marker: "window-like-receiver" };

    await intercepted.call(customThis, "https://api.example.com/users");

    expect(receivedThis).toBe(customThis);
  });

  it("does not call the original more than once per call", async () => {
    const original = vi.fn(async () => new Response());
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    await intercepted("https://api.example.com/a");
    await intercepted("https://api.example.com/b");

    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenNthCalledWith(1, "https://api.example.com/a");
    expect(original).toHaveBeenNthCalledWith(2, "https://api.example.com/b");
  });

  it("supports the Request-object calling convention, unchanged", async () => {
    const original = vi.fn(async () => new Response());
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);
    const request = new Request("https://api.example.com/users");

    await intercepted(request);

    expect(original).toHaveBeenCalledWith(request);
  });
});

// Step 3B (ADR-0010): timing, layered onto the same interceptor rather
// than a second wrapper. Still no bus.report(), still no outcome
// classification — onSettle is a plain observation hook these tests
// exercise directly; Step 3C is what actually gives it something
// meaningful to do.
describe("createFetchInterceptor timing (Step 3B)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports duration and the settled Response from performance.now(), not wall-clock time", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(137);
    const fakeResponse = new Response();
    const original = vi.fn(async () => fakeResponse);
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    await intercepted("https://api.example.com/users");

    expect(onSettle).toHaveBeenCalledWith({
      state: "fulfilled",
      response: fakeResponse,
      duration: 37,
      request: { method: "GET", url: "https://api.example.com/users" },
    });
  });

  it("reports a rejected state with duration and the rejection reason when the original rejects", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(500).mockReturnValueOnce(542);
    const theError = new TypeError("Failed to fetch");
    const original = vi.fn(() => Promise.reject(theError));
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    // The caller's own rejection is unaffected by onSettle existing —
    // still asserted here so a future refactor can't silently start
    // swallowing it.
    await expect(intercepted("https://api.example.com/users")).rejects.toThrow("Failed to fetch");
    expect(onSettle).toHaveBeenCalledWith({
      state: "rejected",
      error: theError,
      duration: 42,
      request: { method: "GET", url: "https://api.example.com/users" },
    });
  });

  it("resolves method/url from a plain string URL, defaulting method to GET", async () => {
    const original = vi.fn(async () => new Response());
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    await intercepted("https://api.example.com/orders");

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { method: "GET", url: "https://api.example.com/orders" },
      })
    );
  });

  it("resolves method from RequestInit when provided alongside a string URL", async () => {
    const original = vi.fn(async () => new Response());
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    await intercepted("https://api.example.com/orders", { method: "post" });

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { method: "POST", url: "https://api.example.com/orders" },
      })
    );
  });

  it("resolves method/url from a Request object", async () => {
    const original = vi.fn(async () => new Response());
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);
    const request = new Request("https://api.example.com/items", {
      method: "DELETE",
    });

    await intercepted(request);

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { method: "DELETE", url: "https://api.example.com/items" },
      })
    );
  });

  it("does not call onSettle before the promise actually settles", () => {
    const original = vi.fn(async () => new Response());
    const onSettle = vi.fn();
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    intercepted("https://api.example.com/users");

    // Deliberately not awaited above — onSettle should not have fired
    // synchronously just because the call was made.
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("still returns the exact same promise instance with onSettle present", () => {
    const originalPromise = Promise.resolve(new Response());
    const original = vi.fn(() => originalPromise);
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, vi.fn());

    const returned = intercepted("https://api.example.com/users");

    expect(returned).toBe(originalPromise);
  });

  it("does not call onSettle when the original throws synchronously", () => {
    const onSettle = vi.fn();
    const original = vi.fn(() => {
      throw new Error("thrown synchronously");
    });
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    expect(() => intercepted("https://api.example.com/users")).toThrow();
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("does not let an exception in onSettle affect the value the caller sees", async () => {
    const fakeResponse = new Response();
    const original = vi.fn(async () => fakeResponse);
    const onSettle = vi.fn(() => {
      throw new Error("hook is broken");
    });
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch, onSettle);

    // If onSettle's failure leaked anywhere the caller could observe,
    // this would reject or resolve to something else instead.
    const result = await intercepted("https://api.example.com/users");
    expect(result).toBe(fakeResponse);
  });

  it("works with onSettle omitted — timing is measured but nothing is called", async () => {
    const original = vi.fn(async () => new Response());
    const intercepted = createFetchInterceptor(original as unknown as typeof fetch);

    await expect(intercepted("https://api.example.com/users")).resolves.toBeInstanceOf(Response);
  });
});
