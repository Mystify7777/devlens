# 0006: Plugin Contract

## Status

Accepted

## Decision

Every first-party DevLens package implements the same lifecycle, defined
once in `@devlens/core` as the `Plugin` interface:

```ts
export interface Plugin {
  install(): void;
  uninstall(): void;
}
```

Both methods must be idempotent. Plugins consume only Core's public API —
no plugin is privileged or gets access to anything a third-party plugin
author couldn't also use.

## Why now, not earlier

This wasn't speculated in advance. Runtime was built first as its own
`install()`/`uninstall()` pair; Console is about to become a second real
implementation of the identical shape. Two real consumers is what
justifies extracting a shared interface — one consumer would have been
premature abstraction (the same trap `assert.ts`/`now()` fell into
earlier in Core's history).

## Consequences

- `RuntimePlugin` (in `@devlens/runtime`) is now a type alias for `Plugin`,
  not a separate interface — kept as a named alias for local readability,
  not because it has runtime-specific members.
- Console, Network, and React should each export `create*Plugin(bus): Plugin`
  (or a locally-aliased type of it) rather than inventing their own
  install/uninstall shape.

## Amendment (via ADR-0013): React is component-shaped, not `Plugin`-shaped

The Consequences section above states that React "should each export
`create*Plugin(bus): Plugin`," grouped with Console and Network as if
all three needed the identical factory shape. **That claim about
React specifically is corrected by ADR-0013 (React Integration Role).**

Console and Network both need an explicit `install()`/`uninstall()`
pair because both patch or attach a listener to a *global* — the
`console.*` methods, `window.fetch`, `XMLHttpRequest.prototype` — that
must be restored on teardown. Runtime is the same: `window`
event listeners, added and removed explicitly. React's proposed
capture mechanism (ADR-0013: a client-side error-boundary component
reporting `errorInfo.componentStack` via `bus.report()`) has no
global to patch at all — it is a component, mounted and unmounted by
React's own render cycle. Forcing it into the literal `Plugin`
interface (`{ install(): void; uninstall(): void }`) would require
inventing meaningless install/uninstall semantics for a mechanism that
doesn't need them, purely to match an interface whose actual
justification (see "Why now, not earlier," above: two real global-
patching consumers) never applied to React in the first place.

**React remains on the Capture axis** (ADR-0009) — it still observes
something and reports through the same `EventBus` every other capture
source uses. What changes is only the *shape* of its public export:
directionally, something like `createDevLensErrorBoundary(bus):
React.ComponentType`, not `create*Plugin(bus): Plugin`. This is a
correction to this ADR's Consequences section, not a reopening of the
`Plugin` interface itself, which remains exactly as decided above for
Runtime, Console, and Network — none of the reasoning in this ADR
that actually applies to those three (idempotent install/uninstall,
no privileged access) is weakened or revisited by this amendment.
