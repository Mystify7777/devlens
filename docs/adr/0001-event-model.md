# 0001: Event Model

## Status

Accepted

## Decision

`DevLensEvent` uses:

- A hybrid `EventCategory` (closed builtin set + open string) so plugins can
  report custom categories without patching core.
- A closed `EventSeverity` union (`trace`..`fatal`) — kept closed because
  severity drives UI rendering (color/icon/sort), unlike category.
- `origin` (not `source`) to describe which concrete signal produced the
  event (e.g. "window.onerror", "vite", "plugin:apollo").
- Separate `metadata` (event-specific data) and `context` (environmental
  data) fields, plus optional `tags` for search/filtering.
- A `version: 1` field so the schema can evolve without breaking older
  plugins reporting the older shape.

## Alternatives considered

- Plain `string` severity: rejected — no type safety for UI code that
  switches on severity.
- Folding context into metadata: rejected — conflates "what happened"
  with "what was the environment," which will matter once cross-event
  search/filtering exists.

## Consequences

- `id`, `version`, and `timestamp` are all optional on `DevLensEventInput`
  and assigned by the Event Bus, not the caller — plugins stay simple.
