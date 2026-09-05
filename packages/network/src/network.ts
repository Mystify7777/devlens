import type { EventBus, Plugin } from "@devlens/core";
import { createFetchInterceptor, type FetchSettleInfo } from "./interceptors/fetch-interceptor";
import { installXhrInterceptor, type XhrSettleInfo } from "./interceptors/xhr-interceptor";
import { classifyFetchOutcome } from "./classifiers/fetch-outcome";
import { classifyXhrOutcome } from "./classifiers/xhr-outcome";
import { normalizeNetworkEvent } from "./normalizers/network-normalizer";
import type { CapturedRequest } from "./types";

/**
 * Phase 0.5 (ADR-0010) locked the package's public surface. Step 3
 * (3A–3C) built Fetch capture end to end. Step 4B adds async XHR
 * capture alongside it — see docs/research/xhr-capture.md for why
 * synchronous XHR is an explicit, documented non-goal rather than a
 * silently-missing case: the research verified that none of the
 * events XHR capture depends on ever fire for a synchronous request,
 * not merely that supporting it would be harder.
 *
 * `network.ts` is deliberately the *only* place that knows about all
 * of classifier + normalizer + Bus at once, for either capture
 * mechanism — see each classifier's and the normalizer's own doc
 * comments for why none of them are allowed to know about each other.
 * This function is the composition point, and nothing more; it
 * invents no logic of its own beyond assembling a `CapturedRequest`
 * from what the classifiers and interceptors already decided.
 *
 * Fetch and XHR remain two independent, separately-implemented
 * capture mechanisms — see ADR-0010's Interception mechanism section,
 * and the "no shared interceptor abstraction yet" instruction that
 * governed this step. The only place they visibly converge is
 * `CapturedRequest` itself and the `origin` field distinguishing them
 * — nothing downstream (Panel, Export, a future Import) needs to know
 * or care which one produced a given event.
 *
 * Precedent for shipping a real, tested, deliberately-inert scaffold
 * before the interesting logic exists: Panel's own Session 2/3 scaffold
 * (`DEVLENS_CONTEXT_HANDOFF.md`) — `install()`/`uninstall()` were real
 * and tested there too, before rendering existed.
 */
export function createNetworkPlugin(bus: EventBus): Plugin {
  let installed = false;
  let originalFetch: typeof fetch | null = null;
  let restoreXhr: (() => void) | null = null;

  function handleFetchSettle(info: FetchSettleInfo): void {
    const { outcome, severity } =
      info.state === "fulfilled"
        ? classifyFetchOutcome({ state: "fulfilled", response: info.response })
        : classifyFetchOutcome({ state: "rejected", error: info.error });

    const capturedRequest: CapturedRequest = {
      origin: "fetch",
      method: info.request.method,
      url: info.request.url,
      status: info.state === "fulfilled" ? info.response.status : null,
      duration: info.duration,
      outcome,
      severity,
    };

    bus.report(normalizeNetworkEvent(capturedRequest));
  }

  function handleXhrSettle(info: XhrSettleInfo): void {
    const { outcome, severity } = classifyXhrOutcome({
      event: info.event,
      status: info.status,
    });

    const capturedRequest: CapturedRequest = {
      origin: "xhr",
      method: info.request.method,
      url: info.request.url,
      // Only a `load` settlement represents a real, received response
      // — matching CapturedRequest.status's existing meaning from the
      // Fetch path (null when no response was ever received), rather
      // than reporting XHR's raw `status` (typically 0 for
      // error/abort/timeout) as if it carried the same information.
      status: info.event === "load" ? info.status : null,
      duration: info.duration,
      outcome,
      severity,
    };

    bus.report(normalizeNetworkEvent(capturedRequest));
  }

  return {
    install() {
      if (installed) return;
      if (typeof window === "undefined") return;

      // Each capture mechanism installs independently — the absence
      // of one (an old environment without fetch, for instance)
      // should never prevent the other from working.
      if (typeof window.fetch === "function") {
        // Stored, not bound — see fetch-interceptor.ts for why
        // binding at wrap time would be an unnecessary behavior
        // change.
        originalFetch = window.fetch;
        window.fetch = createFetchInterceptor(originalFetch, handleFetchSettle);
      }

      if (typeof XMLHttpRequest !== "undefined") {
        restoreXhr = installXhrInterceptor(handleXhrSettle);
      }

      installed = true;
    },

    uninstall() {
      if (!installed) return;

      if (typeof window !== "undefined" && originalFetch) {
        window.fetch = originalFetch;
      }
      originalFetch = null;

      if (restoreXhr) {
        restoreXhr();
        restoreXhr = null;
      }

      installed = false;
    },
  };
}
