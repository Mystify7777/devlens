# 0003: Naming — report() vs publish()/emit()

## Status

Accepted

## Validation

Pending first real plugin (Runtime, Console).

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

Provisionally accepted for Core Alpha. The real test is whether `report()`
still feels right once `runtime` and `console` are built against it — if
either package finds itself fighting the name, that's a signal to revisit,
not a sign the plugin is wrong.
