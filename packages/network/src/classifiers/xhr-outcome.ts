import type { OutcomeClassification } from "./fetch-outcome";

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
 * **Known, accepted duplication**: the status-range-to-outcome mapping
 * below (2xx/4xx/5xx/fallback) is identical to the second half of
 * `classifyFetchOutcome()`'s fulfilled branch. This is real, visible
 * evidence — not a hypothetical — that a narrow, shared
 * `classifyHttpStatus(status)` helper might now be justified (two real
 * consumers exist). Deliberately not extracted in this change, per
 * the explicit instruction not to abstract until XHR actually
 * demonstrated a real shared mapping — it has, now the duplication is
 * visible in both files for that decision to be made deliberately,
 * not preemptively.
 */
export function classifyXhrOutcome(
  settlement: XhrSettlement
): OutcomeClassification {
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

  // event === "load": a response was received.
  const { status } = settlement;

  if (status >= 200 && status < 300) {
    return { outcome: "success", severity: "info" };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "http-error", severity: "warn" };
  }
  if (status >= 500 && status < 600) {
    return { outcome: "http-error", severity: "error" };
  }

  // A `load` event fired with a status this function didn't
  // anticipate — a response was genuinely received, which is evidence
  // of success, not failure. Same "report the broader observable
  // category rather than guess" rule as classifyFetchOutcome's own
  // fallback.
  return { outcome: "success", severity: "info" };
}
