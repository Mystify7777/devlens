import type { EventSeverity } from "@devlens/core";

/**
 * Outcome classification, locked via the classification-contract
 * discussion following ADR-0010 (the ADR's own draft had five values;
 * `"opaque"` was added once the discussion worked through the
 * `status === 0` case honestly — see
 * `src/classifiers/fetch-outcome.ts` for the full, tested contract).
 * Kept in exactly one place on purpose: if the enum changes again,
 * this is the only file that has to.
 */
export type NetworkOutcome =
  "success" | "http-error" | "network-error" | "aborted" | "timeout" | "opaque";

/**
 * The seam between the two capture mechanisms (Step 3: fetch, Step 4:
 * XHR) and the one normalization pipeline (normalizeNetworkEvent).
 * Internal only — never exported from index.ts, never becomes public
 * API. By the time a CapturedRequest exists, every judgment call has
 * already been made: outcome classification, severity mapping, and
 * query-value redaction all happen in the capture layer, before this
 * shape is constructed. normalizeNetworkEvent() only formats it.
 */
export interface CapturedRequest {
  /** Which capture mechanism produced this — "fetch" or "xhr" (Step 3/4 sets this). */
  origin: string;
  method: string;
  /** Already redacted by the capture layer (query values, per ADR-0010) — normalization does not touch it. */
  url: string;
  /** null when no response was ever received (network-error/aborted/timeout). */
  status: number | null;
  /** Milliseconds, timed directly by the interceptor around the original call (ADR-0010's "Interception mechanism"). */
  duration: number;
  outcome: NetworkOutcome;
  /**
   * Already resolved by the capture layer's outcome→severity mapping
   * (ADR-0010: an explicitly open question, decoupled from `outcome`
   * on purpose — see the research doc's "Outcome and severity are
   * different axes"). Normalization does not decide this.
   */
  severity: EventSeverity;
  /**
   * Issue #18 / ADR-0010 amendment. Raw, unmodified Content-Type
   * header value (parameters like charset preserved, nothing parsed
   * or normalized). `null` means unavailable to DevLens at the
   * capture boundary — absent header, opaque response, or no response
   * at all — not necessarily "the server didn't send one." See the
   * amendment for the full availability matrix.
   */
  contentType: string | null;
  /**
   * Issue #18 / ADR-0010 amendment. The Content-Length header's value,
   * parsed only when it matches Content-Length's own grammar
   * (1*DIGIT) and is representable as a JavaScript safe integer —
   * see parseContentLength(). This is header metadata the response
   * supplied, not a measurement of decoded body size or actual
   * network transfer size; see the amendment for why those can
   * diverge. `0` is a valid, meaningful result, distinct from `null`.
   */
  contentLength: number | null;
}
