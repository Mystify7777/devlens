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
  