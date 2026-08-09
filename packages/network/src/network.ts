import type { EventBus, Plugin } from "@devlens/core";
import {
  createFetchInterceptor,
  type FetchSettleInfo,
} from "./interceptors/fetch-interceptor";
import { classifyFetchOutcome } from "./classifiers/fetch-outcome";
import { normalizeNetworkEvent } from "./normalizers/network-normalizer";
import type { CapturedRequest } from "./types";

/**
 * Phase 0.5 (ADR-0010) locked the package's public surface. Step 3A
 * wired interception; Step 3B added timing; Step 3C — this file's
 * `handleFetchSettle` — closes the loop: every completed `fetch()`
 * call becomes exactly one `CapturedRequest`, normalized, and reported
 * to the Bus. A synchronous throw from the original `fetch` never
 * reaches this handler at all (see fetch-interceptor.ts) — no
 * settlement occurred, so no event is reported, matching ADR-0010's
 * "one real-world occurrence, one immutable event" model exactly.
 *
 * `network.ts` is deliberately the *only* place that knows about all
 * three pieces (classifier, normalizer, Bus) at once — see the
 * classifier's and normalizer's own doc comments for why neither is
 * allowed to know about the other. This function is the composition
 * point, and nothing more; it invents no logic of its own beyond
 * assembling a `CapturedRequest` from what the other three already
 * decided.
 *
 * XHR (Step 4) is a separate milestone — see ADR-0010's Interception
 * mechanism section for why fetch and XHR are treated as two
 * independent capture mechanisms rather than a shared abstraction
 * built before either one is proven. This Fetch path, once green, is
 * what XHR's implementation gets compared against — not a shared base
 * class extracted ahead of having two real examples.
 *
 * Precedent for shipping a real, tested, deliberately-inert scaffold
 * before the interesting logic exists: Panel's own Session 2/3 scaffold
 * (`DEVLENS_CONTEXT_HANDOFF.md`) — `install()`/`uninstall()` were real
 * and tested there too, before rendering existed.
 */
export function createNetworkPlugin(bus: EventBus): Plugin {
  let installed = false;
  let originalFetch: typeof fetch | null = null;

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

  return {
    install() {
      if (installed) return;
      if (typeof window === "undefined") return;
      if (typeof window.fetch !== "function") return;

      // Stored, not bound — see fetch-interceptor.ts for why binding
      // at wrap time would be an unnecessary behavior change.
      originalFetch = window.fetch;
      window.fetch = createFetchInterceptor(originalFetch, handleFetchSettle);

      // TODO(Step 4): patch XMLHttpRequest.prototype.open/send the
      // same way, as its own milestone — see ADR-0010's "Interception
      // mechanism" and the implementation plan's Step 3/Step 4 split.

      installed = true;
    },

    uninstall() {
      if (!installed) return;
      if (typeof window !== "undefined" && originalFetch) {
        window.fetch = originalFetch;
      }

      originalFetch = null;
      installed = false;
    },
  };
}
