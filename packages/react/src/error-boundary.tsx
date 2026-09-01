"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { EventBus } from "@devlens/core";

/**
 * Public props — deliberately minimal, per Issue #7's frozen API
 * contract. `fallback` is optional and defaults to rendering nothing
 * (`null`) rather than any styled/default error UI — this package
 * observes and reports, it never decides what the host application's
 * users see. See ADR-0013: this is a capture integration, not a
 * Panel wrapper, and rendering opinionated UI would blur that line.
 */
export interface DevLensErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface DevLensErrorBoundaryState {
  hasError: boolean;
}

/**
 * Defensive runtime normalization for `componentDidCatch`'s first
 * argument. React's own type declares this parameter as `Error`
 * (`componentDidCatch(error: Error, ...)`, unchanged below) — but that
 * declared type is a claim, not a runtime guarantee: JS `throw` has no
 * type constraint, so a component can still throw a string, object,
 * or anything else despite what the lifecycle's type signature says.
 * This function normalizes whatever value actually arrives at
 * runtime into a displayable string; it does not change or widen
 * `componentDidCatch`'s declared signature.
 *
 * Deliberately a small, local equivalent of Runtime's
 * `describeReason()` (packages/runtime/src/normalizers/
 * runtime-normalizer.ts), not an import of it. Per Issue #8's
 * explicit constraint, `@devlens/react` must not depend on
 * `@devlens/runtime` merely to reuse this small helper; duplicating
 * a few lines here is the correct trade against introducing a
 * cross-capture-package dependency edge that doesn't otherwise exist
 * anywhere in this project (confirmed: no capture package currently
 * depends on another).
 *
 * Unlike Runtime's version, this only ever needs to produce the
 * `message` string — `stack` is computed separately, inline, at the
 * `componentDidCatch` call site, per Issue #7's frozen event shape.
 */
function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Creates a React error boundary component bound to a specific
 * EventBus. Matches the `create*(bus)` factory shape already used by
 * `createRuntimePlugin`/`createConsolePlugin`/`createNetworkPlugin` —
 * `bus` is supplied once, at creation time, rather than as a prop on
 * every render (avoiding both a re-render/prop-identity concern and a
 * departure from the established convention).
 *
 * Deliberately NOT `Plugin`-shaped (no `install()`/`uninstall()`) —
 * per ADR-0013's amendment to ADR-0006, a React error boundary has no
 * global to patch; its own mount/unmount, driven by React's render
 * tree, is the only lifecycle it needs.
 *
 * Client-only, per ADR-0013: `bus.report()` is skipped whenever
 * `window` is unavailable, matching the identical defensive pattern
 * already used by Panel/Runtime/Console (`typeof
 * document/window/console === "undefined"`, return early). This
 * guard describes only that one thing — it makes no claim about
 * whether or how `componentDidCatch`/error-boundary fallback
 * rendering behaves during SSR or in React Server Components, which
 * is unverified and out of scope for this package (ADR-0013 does not
 * attempt SSR/RSC instrumentation).
 */
export function createDevLensErrorBoundary(
  bus: EventBus
): React.ComponentType<DevLensErrorBoundaryProps> {
  return class DevLensErrorBoundary extends Component<
    DevLensErrorBoundaryProps,
    DevLensErrorBoundaryState
  > {
    state: DevLensErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): DevLensErrorBoundaryState {
      return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
      // Client-only (ADR-0013): skip reporting when `window` is
      // unavailable. This guard makes no claim about SSR/RSC
      // error-boundary or fallback-rendering behavior — that is
      // unverified and not addressed by this package; it only
      // prevents the reporting side effect from running outside a
      // browser environment.
      if (typeof window === "undefined") return;

      try {
        bus.report({
          origin: "react.componentDidCatch",
          category: "framework",
          severity: "error",
          title: "React Component Error",
          message: describeReason(error),
          stack: error instanceof Error ? error.stack : undefined,
          metadata: {
            componentStack: errorInfo.componentStack,
          },
        });
      } catch {
        // Never let DevLens's own instrumentation become the host
        // application's problem — the same invariant every other
        // capture package in this project already follows (Console's
        // narrow catch around bus.report(), Network's onSettle
        // guards).
      }
    }

    render(): ReactNode {
      if (this.state.hasError) {
        return this.props.fallback ?? null;
      }
      return this.props.children;
    }
  };
}
