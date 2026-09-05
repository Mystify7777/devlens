import type { EventSeverity } from "@devlens/core";
import type { NetworkOutcome } from "../types";

export interface OutcomeClassification {
  outcome: NetworkOutcome;
  severity: EventSeverity;
}

/**
 * Only what a fetch interceptor's `.then()`/`.catch()` handlers
 * actually receive — a settled `Response`, or the rejection reason.
 * Deliberately excludes `duration`: the classification contract
 * (docs/adr/0010-network-plugin.md, locked after the research/ADR
 * discussion) is that a request's cause is inferred only from what
 * Fetch actually settled with, never from how long it took. A
 * function that can't receive duration can't accidentally start
 * leaning on it later — the exclusion is enforced by this type, not
 * just a comment asking nicely.
 */
export type FetchSettlement =
  { state: "fulfilled"; response: Response } | { state: "rejected"; error: unknown };

/**
 * Pure: FetchSettlement -> { outcome, severity }. No duration, no
 * AbortSignal (classifies what Fetch settled with, not how the
 * caller configured the request), no URL, no EventBus access.
 *
 * `AbortError` and `TimeoutError` are classified separately rather
 * than treated as the same thing — see the research doc's
 * "fetch/XHR timeout-vs-abort asymmetry" finding. Fetch can only
 * reliably distinguish them when the calling code uses the newer
 * `AbortSignal.timeout()` specifically; a manual
 * `setTimeout(() => controller.abort())` pattern still produces a
 * plain `AbortError`, which this function honestly reports as
 * `aborted`, not a guessed `timeout` — the rule this whole contract
 * rests on is: if the browser doesn't provide enough information to
 * distinguish two causes, report the broader observable category
 * rather than guess.
 */
export function classifyFetchOutcome(settlement: FetchSettlement): OutcomeClassification {
  if (settlement.state === "rejected") {
    // Duck-typed, not `instanceof Error` — verified this matters, not
    // just theoretical caution: jsdom's own `DOMException` does not
    // extend `Error` (`instanceof Error` is false there, true in
    // real browsers and in plain Node), so an `instanceof` check here
    // would silently misclassify real AbortError/TimeoutError
    // instances as `network-error` in that environment. Checking for
    // a string `.name` avoids depending on any particular prototype
    // chain relationship at all.
    const name =
      typeof settlement.error === "object" &&
      settlement.error !== null &&
      "name" in settlement.error &&
      typeof (settlement.error as { name: unknown }).name === "string"
        ? (settlement.error as { name: string }).name
        : undefined;

    if (name === "AbortError") {
      return { outcome: "aborted", severity: "info" };
    }
    if (name === "TimeoutError") {
      return { outcome: "timeout", severity: "warn" };
    }
    return { outcome: "network-error", severity: "error" };
  }

  const { response } = settlement;

  // A `Response` whose `type` is `"error"` is deliberately not
  // branched on here — verified, not assumed. Per MDN's
  // `Response.error()` documentation, a type:"error" Response is a
  // Service Worker construct: a service worker returns one from a
  // fetch-event handler specifically to make the *calling* page's
  // `fetch()` promise reject, not to let it resolve. Since ADR-0010
  // rejected Service Worker interception for v1 (this plugin patches
  // `window.fetch` directly), a plain page-script `fetch()` call can
  // never *resolve* into this function with `response.type ===
  // "error"` — that path is unreachable under this project's
  // interception model, not merely unlikely. Adding a branch for it
  // would be exactly the "museum of theoretical possibilities" this
  // contract was written to avoid.

  if (response.status === 0 && (response.type === "opaque" || response.type === "opaqueredirect")) {
    return { outcome: "opaque", severity: "info" };
  }

  if (response.status >= 200 && response.status < 300) {
    return { outcome: "success", severity: "info" };
  }

  if (response.status >= 400 && response.status < 500) {
    return { outcome: "http-error", severity: "warn" };
  }

  if (response.status >= 500 && response.status < 600) {
    return { outcome: "http-error", severity: "error" };
  }

  // Fulfilled with a status this function didn't anticipate — a raw
  // 3xx is effectively unreachable via either fetch mode (MDN's
  // Response.status page: status reads 0 for opaque/opaqueredirect/
  // error responses; a followed redirect chain only ever exposes its
  // final response), and 1xx informational responses aren't normally
  // surfaced to fetch() callers either. Whatever this actually is, a
  // response was genuinely received — that's evidence of success, not
  // failure, so this reports the broader observable category rather
  // than inventing an http-error the data doesn't support.
  return { outcome: "success", severity: "info" };
}
