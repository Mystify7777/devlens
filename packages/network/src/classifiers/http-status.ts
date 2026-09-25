import type { EventSeverity } from "@devlens/core";
import type { NetworkOutcome } from "../types";

export interface OutcomeClassification {
  outcome: NetworkOutcome;
  severity: EventSeverity;
}

/**
 * Classifies an HTTP status received by Fetch or XHR.
 *
 * Transport-specific failures, aborts, timeouts, and Fetch opaque
 * responses are classified by the respective capture classifier.
 *
 * Unexpected status values fall back to success/info because receiving
 * a response is evidence of a completed request, not an HTTP error.
 */
export function classifyHttpStatus(status: number): OutcomeClassification {
  if (status >= 200 && status < 300) {
    return { outcome: "success", severity: "info" };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "http-error", severity: "warn" };
  }
  if (status >= 500 && status < 600) {
    return { outcome: "http-error", severity: "error" };
  }
  return { outcome: "success", severity: "info" };
}
