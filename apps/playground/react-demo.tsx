import { useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { EventBus } from "@devlens/core";
import { createDevLensErrorBoundary } from "@devlens/react";

/**
 * Deterministic, isolated React demo for Issue #11. This file is the
 * only place in the Playground that touches JSX/React — `main.ts`
 * stays plain TypeScript. No new bus, store, or Panel wiring is
 * introduced here: `mountReactDemo` receives the Playground's single
 * shared `EventBus` and passes it straight into
 * `createDevLensErrorBoundary`, the same instance every other capture
 * source in this app already reports through.
 *
 * Throwing directly during initial render would foreclose the ability
 * to trigger the error interactively (the component would never
 * render a button at all), so the failure is deferred behind local
 * `shouldThrow` state, flipped by a click — the standard deterministic
 * error-boundary demo shape.
 */
function BuggyComponent(): ReactElement {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error("Playground: intentional React render error");
  }

  return <button onClick={() => setShouldThrow(true)}>Throw inside React component</button>;
}

/**
 * Mounts the demo into `container`, wrapping `BuggyComponent` in an
 * error boundary bound to `bus`. Fallback is a short inline message —
 * not styled UI, per the package's "no default error UI" contract;
 * this is Playground-owned fallback content, not something
 * `@devlens/react` provides.
 */
export function mountReactDemo(bus: EventBus, container: HTMLElement): void {
  const DevLensErrorBoundary = createDevLensErrorBoundary(bus);

  const root = createRoot(container);
  root.render(
    <DevLensErrorBoundary fallback={<span>React component crashed — see Panel for details.</span>}>
      <BuggyComponent />
    </DevLensErrorBoundary>
  );
}
