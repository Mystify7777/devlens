import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createEventBus } from "@devlens/core";
import { createDevLensErrorBoundary, type DevLensErrorBoundaryProps } from "./error-boundary";

// React logs a caught error to the console by default; every test
// that triggers an error expects and silences that noise. Hoisted
// into beforeEach/afterEach (rather than each test creating and
// manually .mockRestore()-ing its own spy) so restoration is
// unconditional — a failing assertion partway through a test can no
// longer leak a mocked console.error into every test that runs after
// it in this file.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

/**
 * A component that throws on render, for exercising the error
 * boundary. `shouldThrow` lets a single test re-render into a
 * non-throwing state where relevant (not needed by any test below,
 * kept for parity with common error-boundary testing patterns).
 */
function Bomb({ message = "boom" }: { message?: string }): never {
  throw new Error(message);
}

/**
 * A component that throws a non-Error value. `componentDidCatch`'s
 * declared type says its first argument is `Error` (unchanged in
 * error-boundary.tsx) — but that's a type-level claim, not a runtime
 * guarantee: JS `throw` has no type constraint, so this deliberately
 * throws a plain string to exercise `describeReason()`'s defensive
 * runtime normalization for exactly that mismatch.
 */
function ThrowsString(): never {
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  throw "a plain string reason";
}

describe("createDevLensErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    const bus = createEventBus();
    const Boundary = createDevLensErrorBoundary(bus);

    const { getByText } = render(
      <Boundary>
        <div>all good</div>
      </Boundary>
    );

    expect(getByText("all good")).toBeTruthy();
  });

  it("does not call bus.report() when nothing throws", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("*", handler);
    const Boundary = createDevLensErrorBoundary(bus);

    render(
      <Boundary>
        <div>fine</div>
      </Boundary>
    );

    expect(handler).not.toHaveBeenCalled();
  });

  describe("on a thrown error", () => {
    it("reports exactly one event via the supplied EventBus", () => {
      const bus = createEventBus();
      const handler = vi.fn();
      bus.subscribe("*", handler);
      const Boundary = createDevLensErrorBoundary(bus);

      render(
        <Boundary>
          <Bomb message="something broke" />
        </Boundary>
      );

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("reports the exact event shape frozen in Issue #7", () => {
      const bus = createEventBus();
      const handler = vi.fn();
      bus.subscribe("*", handler);
      const Boundary = createDevLensErrorBoundary(bus);
      render(
        <Boundary>
          <Bomb message="something broke" />
        </Boundary>
      );

      const event = handler.mock.calls[0][0];
      expect(event.origin).toBe("react.componentDidCatch");
      expect(event.category).toBe("framework");
      expect(event.severity).toBe("error");
      expect(event.title).toBe("React Component Error");
      expect(event.message).toBe("something broke");
      expect(typeof event.stack).toBe("string");
      expect(event.stack).toContain("Error");
      expect(typeof event.metadata.componentStack).toBe("string");
      expect(event.metadata.componentStack).toContain("Bomb");
    });

    it("handles a non-Error thrown value without crashing, with stack undefined", () => {
      const bus = createEventBus();
      const handler = vi.fn();
      bus.subscribe("*", handler);
      const Boundary = createDevLensErrorBoundary(bus);
      render(
        <Boundary>
          <ThrowsString />
        </Boundary>
      );

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.message).toBe("a plain string reason");
      expect(event.stack).toBeUndefined();
    });

    it("renders nothing (null) by default when no fallback is provided", () => {
      const bus = createEventBus();
      const Boundary = createDevLensErrorBoundary(bus);
      const { container } = render(
        <Boundary>
          <Bomb />
        </Boundary>
      );

      expect(container.textContent).toBe("");
    });

    it("renders the provided fallback after an error", () => {
      const bus = createEventBus();
      const Boundary = createDevLensErrorBoundary(bus);
      const { getByText } = render(
        <Boundary fallback={<div>recovered</div>}>
          <Bomb />
        </Boundary>
      );

      expect(getByText("recovered")).toBeTruthy();
    });
  });

  describe("instrumentation safety", () => {
    it("does not let a throwing bus.report() escape componentDidCatch", () => {
      const bus = createEventBus();
      bus.destroy(); // report() now throws EventBusDestroyedError
      const Boundary = createDevLensErrorBoundary(bus);
      expect(() =>
        render(
          <Boundary>
            <Bomb />
          </Boundary>
        )
      ).not.toThrow();
    });

    it("does not call bus.report() when window is unavailable (SSR/RSC guard)", () => {
      // Deleting globalThis.window and still rendering through
      // @testing-library/react is not a valid way to simulate this —
      // react-dom's own scheduler reads `window` internally and
      // crashes unrelated to anything this component does (confirmed
      // by attempting exactly that: the failure surfaces inside
      // react-dom's own getCurrentEventPriority, not this file).
      // Instead, this calls componentDidCatch directly on a manually
      // constructed instance, isolating the guard from React-DOM's
      // own environment assumptions entirely.
      const bus = createEventBus();
      const handler = vi.fn();
      bus.subscribe("*", handler);
      const Boundary = createDevLensErrorBoundary(bus) as unknown as new (
        props: DevLensErrorBoundaryProps
      ) => {
        componentDidCatch(error: Error, errorInfo: { componentStack: string }): void;
      };
      const instance = new Boundary({ children: null });

      const realWindow = globalThis.window;
      // @ts-expect-error simulating a non-browser environment
      delete globalThis.window;

      try {
        instance.componentDidCatch(new Error("boom"), {
          componentStack: "\n    in Bomb",
        });
      } finally {
        globalThis.window = realWindow;
      }

      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("independently-created boundaries close over their own bus, not a shared one", () => {
    const busA = createEventBus();
    const busB = createEventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    busA.subscribe("*", handlerA);
    busB.subscribe("*", handlerB);

    const BoundaryA = createDevLensErrorBoundary(busA);
    render(
      <BoundaryA>
        <Bomb />
      </BoundaryA>
    );

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });
});
