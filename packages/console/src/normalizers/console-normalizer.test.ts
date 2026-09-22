import { describe, it, expect } from "vitest";
import { normalizeConsoleCall } from "./console-normalizer";

describe("normalizeConsoleCall", () => {
  it("normalizes a string argument", () => {
    const result = normalizeConsoleCall("log", ["hello"]);
    expect(result.message).toBe("hello");
    expect(result.category).toBe("console");
    expect(result.severity).toBe("info");
    expect(result.origin).toBe("console.log");
    expect(result.title).toBe("Console Log");
  });

  it("normalizes a number argument", () => {
    expect(normalizeConsoleCall("log", [42]).message).toBe("42");
  });

  it("normalizes a boolean argument", () => {
    expect(normalizeConsoleCall("log", [false]).message).toBe("false");
  });

  it("normalizes an Error argument, extracting message and preserving stack", () => {
    const err = new Error("boom");
    const result = normalizeConsoleCall("error", [err]);
    expect(result.message).toBe("boom");
    expect(result.stack).toBe(err.stack);
    expect(result.severity).toBe("error");
  });

  it("normalizes a plain object via JSON.stringify", () => {
    const result = normalizeConsoleCall("log", [{ a: 1 }]);
    expect(result.message).toBe(JSON.stringify({ a: 1 }));
  });

  it("falls back to String() for a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = normalizeConsoleCall("log", [circular]);
    expect(result.message).toBe(String(circular));
  });

  it("preserves all arguments in metadata.args, not just the first", () => {
    const result = normalizeConsoleCall("log", ["first", "second", 3]);
    expect(result.metadata?.args).toEqual(["first", "second", 3]);
    expect(result.message).toBe("first");
  });

  it("handles a call with no arguments", () => {
    const result = normalizeConsoleCall("log", []);
    expect(result.message).toBe("");
    expect(result.metadata?.args).toEqual([]);
  });

  it("maps severity correctly for warn, debug, and info", () => {
    expect(normalizeConsoleCall("warn", ["x"]).severity).toBe("warn");
    expect(normalizeConsoleCall("debug", ["x"]).severity).toBe("debug");
    expect(normalizeConsoleCall("info", ["x"]).severity).toBe("info");
  });

  describe("stack derivation from later arguments (Issue #22)", () => {
    const withStack = (msg: string, stack: string | undefined, Ctor: ErrorConstructor = Error) => {
      const e = new Ctor(msg);
      Object.defineProperty(e, "stack", { value: stack, configurable: true, writable: true });
      return e;
    };

    it("first-arg Error: stack unchanged", () => {
      const e = withStack("a", "STACK_A");
      expect(normalizeConsoleCall("error", [e]).stack).toBe("STACK_A");
    });

    it("string first arg + later Error: message from first arg, stack from Error", () => {
      const e = withStack("boom", "STACK");
      const r = normalizeConsoleCall("error", ["Request failed", e]);
      expect(r.message).toBe("Request failed");
      expect(r.title).toBe("Console Error");
      expect(r.stack).toBe("STACK");
    });

    it("Error after several non-Error args", () => {
      const e = withStack("x", "STACK");
      expect(normalizeConsoleCall("error", ["a", 1, {}, null, "b", e]).stack).toBe("STACK");
    });

    it("Error followed by other args (response object)", () => {
      const e = withStack("x", "STACK");
      expect(normalizeConsoleCall("error", ["a", e, { status: 500 }]).stack).toBe("STACK");
    });

    it("multiple Errors: first with a stack wins", () => {
      const e1 = withStack("1", "S1");
      const e2 = withStack("2", "S2");
      expect(normalizeConsoleCall("error", ["a", e1, e2]).stack).toBe("S1");
    });

    it("first-arg Error is authoritative over later Errors", () => {
      const e1 = withStack("1", "S1");
      const e2 = withStack("2", "S2");
      const r = normalizeConsoleCall("error", [e1, e2]);
      expect(r.message).toBe("1");
      expect(r.stack).toBe("S1");
    });

    it("first-arg Error with undefined stack: no fallback", () => {
      const r = normalizeConsoleCall("error", [withStack("1", undefined), withStack("2", "S2")]);
      expect(r.stack).toBeUndefined();
    });

    it("first-arg Error with empty stack: no fallback", () => {
      const r = normalizeConsoleCall("error", [withStack("1", ""), withStack("2", "S2")]);
      expect(r.stack).toBe("");
    });

    it("skips later Errors with undefined stack", () => {
      const r = normalizeConsoleCall("error", [
        "a",
        withStack("1", undefined),
        withStack("2", "S2"),
      ]);
      expect(r.stack).toBe("S2");
    });

    it("skips later Errors with empty stack", () => {
      const r = normalizeConsoleCall("error", ["a", withStack("1", ""), withStack("2", "S2")]);
      expect(r.stack).toBe("S2");
    });

    it("skips later Errors with non-string stack", () => {
      const bad = withStack("1", 42 as unknown as string);
      const r = normalizeConsoleCall("error", ["a", bad, withStack("2", "S2")]);
      expect(r.stack).toBe("S2");
    });

    it("all later Errors stackless: undefined", () => {
      const r = normalizeConsoleCall("error", ["a", withStack("1", undefined), withStack("2", "")]);
      expect(r.stack).toBeUndefined();
    });

    it("Error subclass counts", () => {
      const e = withStack("t", "TSTACK", TypeError);
      expect(normalizeConsoleCall("error", ["a", e]).stack).toBe("TSTACK");
    });

    it("non-Error { message, stack } lookalike does not count", () => {
      const r = normalizeConsoleCall("error", ["m", { message: "x", stack: "fake" }]);
      expect(r.stack).toBeUndefined();
    });

    it("lookalike does not shadow a real later Error", () => {
      const e = withStack("real", "REAL");
      expect(normalizeConsoleCall("error", ["m", { stack: "fake" }, e]).stack).toBe("REAL");
    });

    it("never invokes getters on non-Error arguments", () => {
      let reads = 0;
      const hostile = {
        get stack() {
          reads++;
          throw new Error("hostile");
        },
        get message() {
          reads++;
          throw new Error("hostile");
        },
      };
      expect(() => normalizeConsoleCall("error", ["m", hostile])).not.toThrow();
      expect(reads).toBe(0);
    });

    it("no Error args: stack undefined", () => {
      expect(normalizeConsoleCall("error", ["a", "b"]).stack).toBeUndefined();
    });

    it("message/title/severity unchanged per method with later Error", () => {
      const e = withStack("x", "S");
      const cases = [
        ["log", "info", "Console Log"],
        ["info", "info", "Console Info"],
        ["debug", "debug", "Console Debug"],
        ["warn", "warn", "Console Warning"],
        ["error", "error", "Console Error"],
      ] as const;
      for (const [m, sev, title] of cases) {
        const r = normalizeConsoleCall(m, ["msg", e]);
        expect(r.message).toBe("msg");
        expect(r.severity).toBe(sev);
        expect(r.title).toBe(title);
      }
    });

    it("metadata.args is the original array with original identities", () => {
      const e = withStack("x", "S");
      const args = ["a", e];
      const r = normalizeConsoleCall("error", args);
      expect(r.metadata?.args).toBe(args);
      expect((r.metadata?.args as unknown[])[1]).toBe(e);
      expect(r.externallyOwned).toEqual([args]);
    });

    it("does not mutate or freeze Error arguments", () => {
      const e = withStack("x", "S");
      const args = ["a", e];
      normalizeConsoleCall("error", args);
      expect(Object.isFrozen(e)).toBe(false);
      expect(Object.isFrozen(args)).toBe(false);
      expect(e.stack).toBe("S");
      expect(args).toHaveLength(2);
    });
  });
});
