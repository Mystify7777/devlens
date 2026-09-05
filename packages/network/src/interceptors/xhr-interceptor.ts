/**
 * Step 4B (ADR-0010, informed by docs/research/xhr-capture.md):
 * async XHR interception only. Synchronous XHR is an explicit,
 * documented non-goal — the research verified that none of the events
 * this file depends on (`load`/`error`/`abort`/`timeout`/`loadend`)
 * are ever dispatched for a synchronous request; there is no event
 * this file could listen for to detect one completing. `send()`
 * below checks for this and delegates straight through, untouched,
 * rather than silently attaching listeners that would simply never
 * fire.
 *
 * The same invariant that governed fetch-interceptor.ts applies here
 * unchanged: **the patched `open`/`send` must behave exactly like the
 * originals** — same arguments, same synchronous throws, same `this`
 * semantics, same return values. DevLens observes; it never
 * interferes.
 *
 * XHR's two-call shape (`open()` configures, `send()` initiates) is
 * genuinely different from Fetch's single call, and creates a real
 * hazard Fetch never had: an `XMLHttpRequest` instance can be reused
 * — `open()` called again, reconfiguring the same object for a new
 * request. A naive implementation that read "what was requested" back
 * out of a mutable, instance-keyed map *inside* the eventual
 * completion handler would risk reading whatever the *next* `open()`
 * call had since written there, misattributing one request's outcome
 * to another's method/URL. This file avoids that by construction: the
 * `WeakMap` below only ever bridges `open()` → `send()` — `send()`
 * reads it once, immediately, and copies what it read into its own
 * local variables before anything asynchronous happens. The
 * `loadend` handler closes over those local variables directly, never
 * over the `WeakMap`. Two overlapping `send()` calls on a reused
 * instance therefore get two independent closures, each anchored to
 * its own request — there is no shared mutable state for a later
 * `open()` to corrupt.
 */
export interface XhrRequestDescriptor {
  method: string;
  url: string;
  async: boolean;
}

export type XhrTerminalEvent = "load" | "error" | "abort" | "timeout";

export interface XhrSettleInfo {
  request: XhrRequestDescriptor;
  /** Milliseconds, from `performance.now()`, measured from send() — see xhr-capture.md's "Timing semantics" for why send(), not open(). */
  duration: number;
  /** Whatever `xhr.status` reads at loadend. Only meaningful when `event === "load"` — see xhr-outcome.ts. */
  status: number;
  /** Which of the four terminal events actually fired — loadend itself carries no information about which one caused it (MDN, confirmed in research); this file resolves that before reporting so the classifier never has to guess. */
  event: XhrTerminalEvent;
}

// Bridges open() -> send() only, per the file-level doc comment above.
// Never read from inside a completion handler.
const pendingDescriptors = new WeakMap<XMLHttpRequest, XhrRequestDescriptor>();

/**
 * Patches `XMLHttpRequest.prototype.open`/`send`. Returns a restore
 * function — call it to put the originals back exactly, the same
 * `uninstall()` shape every other capture mechanism in this project
 * uses.
 */
export function installXhrInterceptor(onSettle?: (info: XhrSettleInfo) => void): () => void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  // Invoked via these plainly-typed aliases only — TypeScript's DOM
  // lib types `.call()`/`.apply()` on an overloaded method using only
  // its last overload's signature, which rejects the valid two-argument
  // `open(method, url)` form. The runtime behavior below is unaffected
  // by this cast; it only changes what TypeScript checks at the call
  // site, not what actually gets called.
  const callOriginalOpen = originalOpen as (...args: unknown[]) => void;
  const callOriginalSend = originalSend as (...args: unknown[]) => void;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    // Forwards exactly what was received — via `arguments`, not a
    // reconstructed fixed-length list — so a two-argument call stays a
    // two-argument call and a five-argument call stays a five-argument
    // call. Reconstructing arguments manually risks padding extra
    // `undefined`s the caller never passed, which is exactly the kind
    // of subtle behavior change this file exists to avoid.
    const result = callOriginalOpen.apply(this, Array.prototype.slice.call(arguments));

    // Only recorded once open() itself didn't throw — matches "capture
    // nothing for a call the browser itself rejected."
    pendingDescriptors.set(this, {
      method: String(method),
      url: String(url),
      // open(method, url) (two-arg form) implies async per the spec;
      // async is only false if explicitly passed as false.
      async: async !== false,
    });

    return result;
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    // Read once, immediately, and never touch the WeakMap again in
    // this call — see the file-level doc comment for why.
    const descriptor = pendingDescriptors.get(this);
    pendingDescriptors.delete(this);

    // No descriptor means open() was never called (or didn't
    // succeed) — send() itself will throw InvalidStateError below,
    // exactly as it would unpatched. Synchronous XHR is explicitly
    // out of scope (see file-level comment): delegate straight
    // through, attach nothing, since none of the events this file
    // depends on would ever fire for it anyway.
    if (!descriptor || descriptor.async === false) {
      return callOriginalSend.apply(this, Array.prototype.slice.call(arguments));
    }

    const start = performance.now();

    // A synchronous throw here (e.g. calling send() twice) propagates
    // immediately — execution never reaches the listeners below, so
    // no event is ever reported for a send() that didn't actually
    // start. Mirrors fetch-interceptor.ts's identical guarantee.
    const result = callOriginalSend.apply(this, Array.prototype.slice.call(arguments));

    let firedEvent: XhrTerminalEvent | null = null;
    const recordEvent = (type: XhrTerminalEvent) => () => {
      firedEvent = type;
    };

    // These four are mutually exclusive by spec (xhr-capture.md,
    // "Abort / timeout / error — classification evidence") and
    // loadend always fires after whichever one of them did — so
    // recording which one fired here, and reporting once from
    // loadend below, can't double-report.
    this.addEventListener("load", recordEvent("load"), { once: true });
    this.addEventListener("error", recordEvent("error"), { once: true });
    this.addEventListener("abort", recordEvent("abort"), { once: true });
    this.addEventListener("timeout", recordEvent("timeout"), { once: true });

    this.addEventListener(
      "loadend",
      () => {
        // Defensive only — per spec one of the four above always
        // fires before loadend for an async request that actually
        // reached send(). Falling back to "error" rather than
        // throwing keeps this consistent with "never let DevLens's
        // own instrumentation become the host application's error."
        //
        // try/catch here is the XHR-shaped equivalent of
        // fetch-interceptor.ts's trailing `.catch(() => {})` on its
        // internal settle chain — same invariant, different mechanism
        // because XHR's completion is a synchronous event-listener
        // callback rather than a promise chain. If onSettle throws
        // (a bug in the classifier, the normalizer, or bus.report()
        // itself), that must never escape this listener: an uncaught
        // exception here would propagate out of dispatchEvent() and
        // become the host application's problem, which is exactly the
        // "DevLens observes; it never interferes" invariant this file
        // is built around.
        try {
          onSettle?.({
            request: descriptor,
            duration: performance.now() - start,
            status: this.status,
            event: firedEvent ?? "error",
          });
        } catch {
          // onSettle threw — deliberately swallowed, see comment above.
        }
      },
      { once: true }
    );

    return result;
  };

  return function uninstall() {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}
