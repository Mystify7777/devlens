import type { OutcomeClassification } from "./http-status";
import { classifyHttpStatus } from "./http-status";

/**
 * Only what a `loadend` handler actually knows: which of the four
 * terminal events fired, and (when it was `load`) what `xhr.status`
 * read. No `duration` here either, for the same reason
 * `FetchSettlement` excludes it — see fetch-outcome.ts.
 */
export interface XhrSettlement {
  event: "load" | "error" | "abort" | "timeout";
  status: number;
}

/**
 * Pure: XhrSettlement -> { outcome, severity }. Deliberately a
 * separate function from `classifyFetchOutcome()`, not the same
 * function fed a translated, Fetch-shaped input — the research
 * (docs/research/xhr-capture.md, "Abort / timeout / error —
 * classification evidence") found that XHR's evidence is categorically
 * different from Fetch's: `ontimeout`/`onabort`/`onerror` are
 * dedicated, mutually-exclusive-by-spec browser signals, not an
 * ambiguous `error.name` this function has to interpret the way
 * `classifyFetchOutcome()` has to for `AbortError`/`TimeoutError`.
 * Forcing XHR's settlement through a Fetch-shaped `Response`/`Error`
 * object just to reuse that function's code would hide a real
 * difference in evidence quality behind a fake shared shape.
 *
 * The status-range-to-outcome mapping (2xx/4xx/5xx/fallback) is
 * shared with Fetch via `classifyHttpStatus()`. Entry logic (which
 * terminal event fired) stays here, not shared: that's where XHR's
 * evidence genuinely differs from Fetch's.
 */
export function classifyXhrOutcome(settlement: XhrSettlement): OutcomeClassification {
  if (settlement.event === "abort") {
    return { outcome: "aborted", severity: "info" };
  }
  if (settlement.event === "timeout") {
    return { outcome: "timeout", severity: "warn" };
  }
  if (settlement.event === "error") {
    // XHR has no equivalent of Fetch's opaque response (no `no-cors`
    // mode exists for XHR) — a CORS-blocked or otherwise network-level
    // failure surfaces here, as `error`, with no separate `opaque`
    // case to consider. See xhr-capture.md's "Redirects and
    // cross-origin behavior."
    return { outcome: "network-error", severity: "error" };
  }

  // event === "load": a response was received. Status-range mapping
  // is shared with Fetch — see classifyHttpStatus.
  return classifyHttpStatus(settlement.status);
}
