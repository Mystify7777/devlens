/**
 * Step 3A (ADR-0010): interception. Step 3B: timing, added here as a
 * small, optional extension rather than a second wrapper layer — see
 * the file-level reasoning below for why growing this file was
 * preferred over composing a second function around it. No reporting
 * yet (3C), no outcome classification yet — this file's job is now:
 * prove `fetch` can be wrapped, and its duration measured, without
 * changing its behavior in any observable way.
 *
 * The one invariant that matters more than anything else in this
 * file: **the wrapped fetch must behave exactly like the original
 * fetch** — same return value, same rejection, same timing, same
 * `this` semantics. If capturing more information would ever require
 * changing any of that, the correct answer is to capture less, not to
 * change fetch's behavior. DevLens observes; it never interferes.
 *
 * Deliberately not wrapped in try/catch around the original call
 * itself: real `fetch()` never throws synchronously, but `original`
 * here might already be someone else's wrapped fetch (a polyfill,
 * another tool's patch) that does. Not catching that is what "behaves
 * exactly like the original" requires — a synchronous throw from
 * `original` must remain a synchronous throw from the interceptor, not
 * get converted into a rejection, and must never reach `onSettle` at
 * all (there was nothing to time).
 *
 * `this` is forwarded via `.apply(this, args)`, not bound at wrap
 * time. `fetch` is a method on the global scope, and some engines
 * have historically thrown "Illegal invocation" when fetch is
 * invoked with a detached receiver — a real, documented browser
 * gotcha, not a hypothetical one. Because the interceptor is a
 * regular function attached as `window.fetch`, calling it as
 * `fetch(...)` or `window.fetch(...)` both invoke it with `this ===
 * window`, which forwarding preserves correctly. Binding at wrap time
 * would change the original's identity for no benefit — an
 * unnecessary deviation from "capture less, change nothing."
 */
export type FetchSettleInfo =
  | {
      state: "fulfilled";
      response: Response;
      duration: number;
      request: RequestDescriptor;
    }
  | {
      state: "rejected";
      error: unknown;
      duration: number;
      request: RequestDescriptor;
    };

/**
 * What was actually requested — resolved once, synchronously, at call
 * time (same timing as `start` below), and carried through to
 * `onSettle` regardless of outcome. Purely descriptive, not
 * classification: `method`/`url` say what was asked for, they don't
 * say what happened.
 */
export interface RequestDescriptor {
  method: string;
  url: string;
}

/**
 * `fetch`'s first argument can be a URL string, a `URL` object, or a
 * `Request` (which already carries its own resolved, normalized
 * method/URL). `RequestInit.method`, when present, always takes
 * precedence — matching how the Fetch spec merges a `Request` with a
 * provided `init`. Deliberately simple: this resolves what was
 * requested, it doesn't attempt to replicate the fetch spec's full
 * Request-construction algorithm for its own sake.
 */
function resolveRequestDescriptor(
  args: Parameters<typeof fetch>
): RequestDescriptor {
  const [input, init] = args;
  let method = "GET";
  let url: string;

  if (input instanceof Request) {
    method = input.method;
    url = input.url;
  } else {
    url = String(input);
  }

  if (init?.method) {
    method = init.method;
  }

  return { method: method.toUpperCase(), url };
}

export function createFetchInterceptor(
  original: typeof fetch,
  onSettle?: (info: FetchSettleInfo) => void
): typeof fetch {
  return function interceptedFetch(
    this: unknown,
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> {
    const start = performance.now();
    const request = resolveRequestDescriptor(args);

    // A synchronous throw from `original` propagates immediately, here
    // — execution never reaches the `.then()` below, and onSettle is
    // never called. Preserving that is Step 3A's invariant, unchanged.
    const result = original.apply(this, args);

    // Side-effect-only chain: measures completion without altering
    // what's returned to the caller below. This `.then()` produces its
    // own, separate derived promise that is deliberately never
    // returned or awaited by this function — only `result` (the
    // original, untouched) is. The trailing `.catch(() => {})` exists
    // specifically so that if `onSettle` itself throws, that failure
    // becomes neither an unhandled rejection nor anything the caller
    // can observe — a hook failing to measure a request must never be
    // allowed to look like the request itself failing. Same discipline
    // as Console's narrow catch scope around bus.report() only
    // (ADR-0007) — DevLens's own instrumentation must never leak into
    // the host application's error surface.
    //
    // `state` (this promise's settlement) is named deliberately unlike
    // HTTP `status` or the eventual `outcome` classification — three
    // different concepts, three different names, on purpose.
    result
      .then(
        (response) =>
          onSettle?.({
            state: "fulfilled",
            response,
            duration: performance.now() - start,
            request,
          }),
        (error) =>
          onSettle?.({
            state: "rejected",
            error,
            duration: performance.now() - start,
            request,
          })
      )
      .catch(() => {
        // onSettle threw — deliberately swallowed, see comment above.
      });

    return result;
  };
}

