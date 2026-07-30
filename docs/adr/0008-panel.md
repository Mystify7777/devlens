# 0008: Panel

## Status

Accepted

## Goals

Give every event a visible destination other than `console.table()`. A
floating overlay that lists events as they arrive, styled consistently,
mountable in one line, with zero configuration required to see something
useful.

## Non-goals (v1)

- Search
- Filtering by category/severity
- Event inspector (expand stack traces, view metadata/args in detail)
- Docking (top/bottom/side)
- Draggable repositioning
- Light/auto theme
- Keyboard shortcut to toggle
- Virtualized scrolling

All of the above are real, expected features — they're deferred, not
rejected. v1's only job is proving the Panel can subscribe to a Store and
render events live, without becoming its own multi-week side-project
before a single event has ever been seen on screen.

## Mount strategy

`createPanel(store): Plugin` — same `install()`/`uninstall()` shape as
every other plugin (ADR-0006), for consistency, even though Panel isn't
"capturing" anything. `install()` appends one host `<div>` to
`document.body`; `uninstall()` removes it and disconnects the store
subscription. Idempotent, matching Runtime/Console.

## Isolation strategy: Shadow DOM

The Panel host element uses `attachShadow({ mode: "open" })`. This is
non-negotiable for v1: DevLens is meant to drop into *any* host
application without CSS collisions in either direction — the host app's
global stylesheet must not leak into the Panel, and the Panel's styles
must not leak into the host app. A plain `<div>` appended to `body` with
scoped class names is not sufficient; global resets, CSS frameworks, or
aggressive `* { }` selectors in the host app could still reach in.

## Rendering strategy: vanilla DOM, not a framework

Panel is a vanilla TypeScript library — no React, no Vue, no build-time
JSX. Rendering is direct, incremental DOM updates: create elements,
update textContent, append/remove nodes on each store change. This is
NOT a diffing/reconciliation system — no virtual DOM, no tree comparison
algorithm. "Diffing" specifically implies that kind of reconciliation
and is the wrong term for what v1 actually does, which is closer to
"append a row when an event arrives, remove the oldest row when over
the display limit." This is a deliberate constraint, not a limitation
to fix later: "drop one script into a page and it appears" is the
actual product goal. If a React-specific experience is wanted later,
`@devlens/react` should wrap the Panel, not replace it.

## Event subscription

Panel takes an `EventStore` (not an `EventBus`) as its constructor
argument — it displays what's been captured, it doesn't capture anything
itself. It calls `store.subscribe()` on install and re-renders on every
new event; `store.getAll()` seeds the initial render so a Panel installed
after events have already occurred isn't empty on first paint.

## Performance

No virtualization in v1 — deferred until it's an observed problem, not
a speculative one. The display limit (`MAX_RENDERED_EVENTS = 300`) is
enforced by `panel.ts`, not the renderer: `panel.ts` slices
`store.getAll()` (or the live event stream) down to the most recent 300
before ever calling `renderer.render(events)`. The renderer only knows
how to draw whatever array it's handed — it has no opinion about how
many events should exist, only how to display them. This keeps the
renderer dumb by design: deciding *what* exists is a policy decision
that belongs one level up, not baked into the drawing code.

## Overlay ownership

`createOverlay()` returns a complete object owning its own lifecycle,
not just raw DOM references for `panel.ts` to manage:

```ts
interface Overlay {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  mount(): void;
  unmount(): void;
}
```

`mount()`/`unmount()` handle appending/removing the host element from
`document.body`. `panel.ts` calls `overlay.mount()` inside `install()`
and `overlay.unmount()` inside `uninstall()`, rather than reaching into
`document.body.appendChild(...)` itself. This keeps DOM lifecycle
ownership with the thing that created the DOM node, instead of letting
`panel.ts` accumulate both plugin lifecycle AND raw DOM management.

## Theming

Dark theme only for v1, matching the visual register developers expect
from a diagnostics overlay (browser DevTools, terminal output). Colors
are defined as CSS custom properties scoped inside the Shadow DOM, so
adding a light theme later is a matter of swapping variable values, not
restructuring markup.

## Accessibility

The Panel will expose appropriate accessibility semantics for a live,
updating event list (screen-reader announcements for new entries at
minimum). Exact implementation (ARIA roles/live-region attributes) is a
Session 3 decision, not specified here — an ADR describing implementation
details before the DOM exists tends to age into stale documentation
rather than a decision record.

## Cleanup lifecycle

`uninstall()` must: disconnect the store subscription, remove the host
element (and its Shadow DOM) from `document.body`, and clear any internal
render state. No listeners or DOM nodes should survive an uninstalled
Panel — same idempotency discipline as Runtime/Console.

## Package structure

```text
packages/panel/
└── src/
    ├── panel.ts          # createPanel(store): Plugin — install/uninstall
    ├── overlay.ts         # host element creation, Shadow DOM attachment
    ├── renderer.ts        # DOM diffing/update logic for the event list
    ├── styles.ts           # CSS custom properties + stylesheet as a string
    ├── components/
    │   └── event-row.ts   # renders a single DevLensEvent as a DOM node
    └── index.ts
```

## Explicitly deferred (tracked for future ADR amendments)

- Search, filtering, inspector — likely ADR-0008 amendment or a new
  ADR-0009 once v1 rendering is proven.
- Docking/dragging.
- Light theme.
- Keyboard shortcuts.
- Virtualized scrolling, if `MAX_RENDERED_EVENTS` ever proves
  insufficient at real event volumes.