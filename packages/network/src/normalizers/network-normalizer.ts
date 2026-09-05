import type { DevLensEventInput } from "@devlens/core";
import type { CapturedRequest } from "../types";

/**
 * Pure function: CapturedRequest -> DevLensEventInput. No side
 * effects, no bus access, no browser API access — testable entirely
 * in isolation, same shape as normalizeErrorEvent() (Runtime) and
 * normalizeConsoleCall() (Console).
 *
 * Deliberately boring, on purpose: this only formats fields it's
 * already been handed. It does not redact URLs, classify outcomes,
 * compute duration, or decide severity — those are Step 3/4 (capture
 * layer) concerns, already resolved before a CapturedRequest exists.
 * Resist the temptation to grow this into
 * `if (outcome === "aborted") ...` branching later; that's
 * classification, and classification belongs upstream, in the capture
 * layer, not here. See ADR-0010's Decision section and the research
 * doc's "Outcome and severity are different axes."
 */
export function normalizeNetworkEvent(request: CapturedRequest): DevLensEventInput {
  return {
    origin: request.origin,
    category: "network",
    severity: request.severity,
    title: `${request.method} ${request.url}`,
    // Branches only on whether a response was ever received (a fact
    // already present on the input), not on what that fact *means* —
    // that distinction is what keeps this a formatter, not a
    // classifier. See the file-level note above.
    message:
      request.status !== null
        ? `${request.status} (${request.duration}ms)`
        : `${request.outcome} (${request.duration}ms)`,
    // Core gained no new fields for Network (ADR-0010: "no changes to
    // Core") — method/url/status/duration/outcome all live here, the
    // same way Console's full argument list lives in metadata.args
    // rather than as new top-level DevLensEvent fields.
    metadata: {
      method: request.method,
      url: request.url,
      status: request.status,
      duration: request.duration,
      outcome: request.outcome,
    },
  };
}
