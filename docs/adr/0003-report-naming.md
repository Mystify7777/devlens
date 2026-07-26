# 0003: Naming — report() vs publish()/emit()

## Decision

Keep `report()`. Considered settled for v0.1 and beyond.

## Reasoning

- `report()` was already established in the original PRD's plugin API
  sketch (`api.report(...)`), before any Event Bus code existed — renaming
  now would create inconsistency between the product vision and the
  implementation.
- `report()` reads plugin-centric: "I observed this and am reporting it,"
  which matches how nearly every event actually gets created — a plugin
  instrumenting `window.onerror`, `fetch`, or Vite's compiler, reporting
  what it saw. `publish()`/`emit()` read event-centric, implying the
  caller authored the event, which is rarely the case here.

## Alternatives considered

- `publish()` — conventional pub/sub naming, but loses the
  observed-and-relayed framing that fits DevLens's plugin model.
- `emit()` — Node `EventEmitter` convention; rejected partly for the same
  reason, and partly because it invites false assumptions about bubbling
  or listener-count semantics that don't apply to this bus.

## Consequences

This is now locked. Revisiting it after `runtime` or `console` ships
against this name would be a real breaking change, not bikeshedding.
