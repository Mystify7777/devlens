import { describe, it, expectTypeOf } from "vitest";
import type { Plugin } from "./plugin";

describe("Plugin contract", () => {
  it("requires install() and uninstall() with no arguments, returning void", () => {
    expectTypeOf<Plugin>().toHaveProperty("install").toEqualTypeOf<() => void>();
    expectTypeOf<Plugin>().toHaveProperty("uninstall").toEqualTypeOf<() => void>();
  });
});