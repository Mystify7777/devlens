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

## Failure behavior

The Panel must never throw into the host application. Rendering failures
are isolated to the Panel and must not affect Runtime, Console, or the
EventStore — inheriting the same "never break the host app" philosophy
established by Runtime and Console (ADR-0005, ADR-0007).

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

## Amendment (Session 4, via ADR-0009): renderer owns two named regions

ADR-0009 ("Interactive Inspection") flagged that adding an inspector
would be the concrete trigger for revisiting this ADR's original
deferral: *"the renderer currently takes the whole ShadowRoot; it
should eventually take a specific `eventListContainer` sub-element."*
This is that revisit.

**Decision:** `createRenderer(shadowRoot)` keeps taking the whole
`ShadowRoot` — it is not narrowed to a pre-built sub-element handed in
from `panel.ts`/`overlay.ts`. Instead, the renderer creates and owns
exactly two named child regions within that root on construction:

```text
ShadowRoot
├── [data-devlens-event-list]   — event rows (existing behavior)
└── [data-devlens-inspector]    — createInspector()'s element
```

`renderEventList(events)` only clears/repopulates the list region.
`renderInspector(event)` only calls into the Inspector's own
`render()`. Neither touches the other's region, which incidentally
also resolves the gap flagged (and deliberately left untested) in the
original renderer test suite: clearing the event list no longer risks
wiping unrelated siblings, because "unrelated siblings" are no longer
inside the same flat container being cleared.

This keeps the renderer mechanical, per this ADR's original intent —
it still has no opinion about selection, clicks, or Panel state (those
remain `panel.ts`'s job, per ADR-0009's Panel state model decision).
Owning two named regions is a layout responsibility, not a policy one:
the renderer decides *where* things render, never *whether* or *what*.

**Non-goal, still deferred:** header/toolbar/footer regions. Only the
event-list/inspector split exists now. If those are added later, this
amendment's structure should extend rather than be redesigned from
scratch — following the same "extend, don't relitigate" discipline
this ADR asked for in the first place.

## Amendment (Session 5): toolbar region, owned by `panel.ts`, not the renderer

This is the "added later" case the amendment above anticipated. Filter
controls (see `docs/specs/inspection.md`'s "Filter controls model")
need a third ShadowRoot region. The layout becomes:

```text
ShadowRoot
├── [data-devlens-toolbar]      — createToolbar()'s element (new)
├── [data-devlens-event-list]   — event rows (existing behavior)
└── [data-devlens-inspector]    — createInspector()'s element
```

**Decision: the toolbar region is created and mounted by `panel.ts`
directly, not by `createRenderer()`.** This is a deliberate asymmetry
with the event-list/inspector split, not an inconsistency:

- `renderer.ts`'s whole reason for existing is to stay mechanical — it
  renders *state* into regions and has no opinion about clicks,
  selection, or Panel lifecycle (this ADR's original intent;
  reaffirmed by the Session 4 amendment above). The event list and
  inspector are both pure projections of state `panel.ts` hands them.
- The toolbar is not a projection of state — it is itself a source of
  state changes (a checkbox toggling *produces* a new `FilterState`).
  Giving the renderer a region whose entire purpose is emitting
  events back out would reintroduce exactly the coupling the Session 4
  amendment was written to avoid.

So `panel.ts` creates the toolbar the same way it creates the overlay
— `createToolbar(onFiltersChange)` — and appends `toolbar.element` to
`overlay.shadowRoot` *before* calling `createRenderer(overlay.shadowRoot)`,
which is what puts the toolbar first in DOM order. `createRenderer()`
itself is completely unaware the toolbar region exists; it still only
knows about the two regions from the Session 4 amendment.

**The toolbar's only outward communication channel is its
`onFiltersChange` callback**, which `panel.ts` wires to the exact same
internal function its own public `setFilters()` method calls. The
toolbar does not import `applyFilters()`, `computeNavigationContext()`,
or the Store — it has no idea the filtering engine exists beyond the
shape of `FilterState` it needs to construct. See inspection.md's
"the toolbar shouldn't even know the filtering engine exists"
principle.

