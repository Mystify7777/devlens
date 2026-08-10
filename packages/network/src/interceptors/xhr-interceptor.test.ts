// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installXhrInterceptor, type XhrSettleInfo } from "./xhr-interceptor";

// XMLHttpRequest.prototype is a global mutable host API, same concern
// as window.fetch in fetch-interceptor's own tests — every test here
// installs its own fake open/send and every test restores the real
// originals afterward, regardless of what the test itself did.
let realOpen: typeof XMLHttpRequest.prototype.open;
let realSend: typeof XMLHttpRequest.prototype.send;

beforeEach(() => {
  realOpen = XMLHttpRequest.prototype.open;
  realSend = XMLHttpRequest.prototype.send;
});

afterEach(() => {
  XMLHttpRequest.prototype.open = realOpen;
  XMLHttpRequest.prototype.send = realSend;
  vi.restoreAllMocks();
});

function setStatus(xhr: XMLHttpRequest, status: number): void {
  Object.defineProperty(xhr, "status", { value: status, configurable: true });
}

describe("installXhrInterceptor — behavior preservation", () => {
  it("forwards open()'s arguments to the original exactly", () => {
    const fakeOpen = vi.fn();
    XMLHttpRequest.prototype.open = fakeOpen;
    XMLHttpRequest.prototype.send = vi.fn();

    installXhrInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users", true);

    expect(fakeOpen).toHaveBeenCalledWith(
      "GET",
      "https://api.example.com/users",
      true
    );
  });

  it("forwards send()'s arguments to the original exactly", () => {
    XMLHttpRequest.prototype.open = vi.fn();
    const fakeSend = vi.fn();
    XMLHttpRequest.prototype.send = fakeSend;

    installXhrInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.example.com/users");
    xhr.send("body content");

    expect(fakeSend).toHaveBeenCalledWith("body content");
  });

  it("propagates a synchronous throw from open() unchanged", () => {
    XMLHttpRequest.prototype.open = vi.fn(() => {
      throw new DOMException("bad method", "SyntaxError");
    });
    XMLHttpRequest.prototype.send = vi.fn();

    installXhrInterceptor();
    const xhr = new XMLHttpRequest();

    expect(() => xhr.open("BAD", "not a url")).toThrow("bad method");
  });

  it("propagates a synchronous throw from send() unchanged, and reports no event", () => {
    XMLHttpRequest.prototype.open = vi.fn();
    XMLHttpRequest.prototype.send = vi.fn(() => {
      throw new DOMException("already sending", "InvalidStateError");
    });
    const onSettle = vi.fn();

    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");

    expect(() => xhr.send()).toThrow("already sending");
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("does not record a descriptor when open() itself throws", () => {
    XMLHttpRequest.prototype.open = vi.fn(() => {
      throw new DOMException("bad method", "SyntaxError");
    });
    XMLHttpRequest.prototype.send = vi.fn();
    const onSettle = vi.fn();

    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    expect(() => xhr.open("BAD", "url")).toThrow();

    // send() now has no descriptor to work with — original send()
    // (a bare vi.fn() here) runs, but no listeners get attached.
    xhr.send();
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("uninstall() restores the exact original open/send references", () => {
    const fakeOpen = vi.fn();
    const fakeSend = vi.fn();
    XMLHttpRequest.prototype.open = fakeOpen;
    XMLHttpRequest.prototype.send = fakeSend;

    const uninstall = installXhrInterceptor();
    expect(XMLHttpRequest.prototype.open).not.toBe(fakeOpen);
    expect(XMLHttpRequest.prototype.send).not.toBe(fakeSend);

    uninstall();
    expect(XMLHttpRequest.prototype.open).toBe(fakeOpen);
    expect(XMLHttpRequest.prototype.send).toBe(fakeSend);
  });
});

describe("installXhrInterceptor — completion reporting", () => {
  beforeEach(() => {
    XMLHttpRequest.prototype.open = vi.fn();
    XMLHttpRequest.prototype.send = vi.fn();
  });

  it("reports exactly one event when 'load' then 'loadend' fire", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    setStatus(xhr, 200);

    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("reports event: 'load' when load fired", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    setStatus(xhr, 200);

    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ event: "load", status: 200 })
    );
  });

  it("reports event: 'error' when error fired", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();

    xhr.dispatchEvent(new Event("error"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ event: "error" })
    );
  });

  it("reports event: 'abort' when abort fired", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();

    xhr.dispatchEvent(new Event("abort"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ event: "abort" })
    );
  });

  it("reports event: 'timeout' when timeout fired", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();

    xhr.dispatchEvent(new Event("timeout"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ event: "timeout" })
    );
  });

  it("computes duration from performance.now(), measured from send()", () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1088);
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    setStatus(xhr, 200);

    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 88 })
    );
  });

  it("carries the method/url captured at open() time", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "https://api.example.com/items/1");
    xhr.send();
    setStatus(xhr, 204);

    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          method: "PUT",
          url: "https://api.example.com/items/1",
          async: true,
        },
      })
    );
  });

  it("does not let an exception in onSettle escape the loadend listener", () => {
    // Regression test for a real gap: onSettle wasn't wrapped in a
    // try/catch, unlike fetch-interceptor.ts's equivalent hook. A
    // throwing onSettle (a bug in the classifier, normalizer, or
    // bus.report() itself) must never become an uncaught exception
    // propagating out of dispatchEvent() — that would be DevLens's
    // own instrumentation becoming the host application's problem,
    // exactly what "DevLens observes; it never interferes" forbids.
    const onSettle = vi.fn(() => {
      throw new Error("onSettle is broken");
    });
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send();
    setStatus(xhr, 200);

    xhr.dispatchEvent(new Event("load"));
    expect(() => xhr.dispatchEvent(new Event("loadend"))).not.toThrow();
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("reports no event when open() happens but send() never does", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");

    // No send() call — dispatching load/loadend anyway proves nothing
    // is listening, since send() is the only place listeners attach.
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).not.toHaveBeenCalled();
  });

  it("reports one event per completed request when the same instance is reused sequentially", () => {
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
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

    expect(onSettle).toHaveBeenCalledTimes(2);
    expect(onSettle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        request: expect.objectContaining({ url: "https://api.example.com/a" }),
      })
    );
    expect(onSettle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        request: expect.objectContaining({ url: "https://api.example.com/b" }),
      })
    );
  });

  it("mandatory: a later open() call does not corrupt an in-flight request's reported descriptor", () => {
    // The exact hazard this design exists to prevent: open() writes a
    // new descriptor into the shared WeakMap before the first
    // request's own completion has fired. Because send() copies the
    // descriptor into its own closure immediately (not re-reading the
    // WeakMap from inside the loadend handler), the first request's
    // still-pending listeners must report its own method/url — "GET
    // /a" — never the second request's "POST /b", even though the
    // WeakMap itself has already been overwritten by the time this
    // fires.
    const onSettle = vi.fn();
    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();

    xhr.open("GET", "https://api.example.com/a");
    xhr.send(); // captures closure A; WeakMap entry for xhr is now deleted

    xhr.open("POST", "https://api.example.com/b"); // WeakMap now holds B's descriptor — irrelevant to A's already-captured closure

    // A's original listeners are still attached (send() for B was
    // never called, so B's listeners were never attached) — firing
    // load/loadend here can only be A's.
    setStatus(xhr, 200);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          method: "GET",
          url: "https://api.example.com/a",
          async: true,
        },
      })
    );
  });
});

describe("installXhrInterceptor — synchronous XHR (explicit non-goal)", () => {
  it("does not attach any listeners for a synchronous request — delegates straight through", () => {
    XMLHttpRequest.prototype.open = vi.fn();
    XMLHttpRequest.prototype.send = vi.fn();
    const onSettle = vi.fn();

    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users", false); // async: false

    const addEventListenerSpy = vi.spyOn(xhr, "addEventListener");
    xhr.send();

    expect(addEventListenerSpy).not.toHaveBeenCalled();

    // Confirms the negative directly too: even if something did fire,
    // nothing would be listening.
    setStatus(xhr, 200);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("still calls the original send() for a synchronous request", () => {
    XMLHttpRequest.prototype.open = vi.fn();
    const fakeSend = vi.fn();
    XMLHttpRequest.prototype.send = fakeSend;

    installXhrInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users", false);
    xhr.send();

    expect(fakeSend).toHaveBeenCalledTimes(1);
  });

  it("treats a two-argument open() (no explicit async) as asynchronous", () => {
    XMLHttpRequest.prototype.open = vi.fn();
    XMLHttpRequest.prototype.send = vi.fn();
    const onSettle = vi.fn();

    installXhrInterceptor(onSettle);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users"); // no third argument
    xhr.send();
    setStatus(xhr, 200);

    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("loadend"));

    expect(onSettle).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ async: true }) })
    );
  });
});
