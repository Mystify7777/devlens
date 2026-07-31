# Interactive Inspection

## Purpose

A developer can understand an event without leaving the DevLens panel.

## Background

See [ADR-0009](../adr/0009-v0.3.0-direction.md) for why v0.3.0-alpha
invests in the Experience axis (inspection, filtering, search) rather
than a new capture source. This document defines the problem space for
that milestone — it does not re-litigate the "why."

## Goals

- Inspect a selected event in full: stack trace, `metadata`, `context`,
  `tags` — everything `DevLensEvent` can carry, not just the
  severity/title/message currently shown in the row.
- Expose all available event data without requiring the developer to
  open the browser console or `console.table()` dump.
- Keep the event list itself usable while inspection is active — the
  list is still the primary navigation surface (see Principles).
- Remain framework-agnostic, vanilla-DOM, Shadow-DOM-isolated — nothing
  about inspection should require reopening ADR-0008's core rendering
  decisions any more than necessary (see Constraints).

## Non-goals

- Network capture (`@devlens/network`) — deferred per ADR-0009, not
  part of this milestone.
- Timeline visualization.
- React-specific APIs (`@devlens/react`).
- Session replay / time-travel debugging.
- Any capture-side changes to Runtime, Console, or the Event Bus. This
  is Experience-axis work only.

## Principles

- The event list remains the primary navigation surface. Inspection is
  a secondary view onto a selected event, not a replacement for the
  list.
- Inspection augments events; it never changes them. Nothing here
  should mutate a `DevLensEvent` or the Store.
- The panel reflects Store state rather than owning event data — this
  extends ADR-0008's "Panel displays, it doesn't capture" to inspection
  specifically: inspection doesn't introduce a second source of truth
  for event data.
- Features should compose rather than couple. Filtering, search, and
  inspection should ideally work independently of one another rather
  than assuming all three exist simultaneously.
- **The event list is the primary navigation surface. The inspector is
  a projection of the currently selected event. It never owns event
  data and never becomes the primary navigation mechanism.** (Session 4,
  Presentation Model decision — see below.)
- **The inspector is not a popup. It is one half of the Panel.**

## Session 4 decisions

Decisions made during Session 4 design discussion, resolved one at a
time per the sequence: Presentation → Selection → Panel state →
Filtering → Search → Pause/Resume → Export. Each entry records the
decision and its justification, not just the conclusion — future
readers should be able to tell *why*, not just *what*.

### Presentation model — Accepted: persistent side inspector

The Panel has two distinct responsibilities: browsing events and
inspecting a selected event. A persistent side inspector expresses
those responsibilities directly, preserving list context and letting
future features (search, filtering, keyboard navigation, and
additional event sources) compose naturally against the same
interaction.

Modal was rejected as fundamentally interruptive — inspecting several
events in sequence becomes a repeated open/close cycle, and that
friction compounds with the number of events under investigation.

Inline accordion was rejected because DevLens event detail (stack
traces, metadata, and future network payloads/headers/bodies) is
measured in screens, not lines. An accordion that scales to that much
content stops behaving like a list and starts behaving like a
document, which works against scanning — the event list's primary job.

**The inspector region is a permanent part of the Panel layout. It is
always mounted.** There is no "drawer open/closed" state — only
`selectedEvent: DevLensEvent | null`. When no event is selected, the
inspector renders an explicit empty state (e.g. "Select an event to
inspect it"), which doubles as in-UI guidance the first time someone
opens DevLens.

Mount/unmount was rejected because it introduces UI lifecycle state
that isn't part of the actual domain model — it would be possible to
end up with "mounted, no selection" or "not mounted, selection exists"
as inconsistent states to synchronize, rather than one clean state
(`selectedEvent`) the UI simply projects from.

The inspector's exact sizing strategy (fixed width, percentage,
resizable, responsive) is explicitly **not** decided here — that's an
implementation concern. Only the region's permanence and the
non-existence of an open/close state are architectural.

**Implications to preserve** (not decisions in themselves — invariants
that later Session 4 decisions should stay consistent with):

- Search, once designed, filters the **list**, not the inspector.
- Keyboard navigation, if it exists, moves through the **list**; the
  inspector updates as a side effect of selection changing, the same
  way it does on click.
- Export, once designed, operates on the **Store** (or a filtered view
  of it) — not on whatever happens to be shown in the inspector.
- The inspector reflects the current selection; it does not itself
  decide what's selected.

### Selection model — Accepted: single selection

The inspector represents one focused inspection context. Selection
answers "which event is currently being inspected?" — it does not
answer "which events are related?" Multi-event comparison is a
distinct future feature (see Future extensions), not an extension of
selection; conflating the two would force today's simple state model
to anticipate a shape (`selectedEvent` vs. `selectedEvents`/relationship
data) that this milestone doesn't need and shouldn't guess at.

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
}
```

No arrays, no sets, no "active vs. primary" distinction.

**Selection is Panel-local UI state, never Store state.** Extending the
existing principle ("the panel reflects Store state rather than owning
event data"): *selection is view state, not event state — it belongs
to the consumer (Panel), never to the Store.* The Store answers "what
events exist?"; the Panel answers "which event is the user currently
looking at?" Letting the Store hold selection would mean any other
consumer (a CLI, a future editor integration) inherits a UI concept
that means nothing to it, and would raise "whose selection?" the
moment more than one consumer exists. That's exactly the kind of
coupling the Store/Bus split (ADR-0004) was built to avoid.

**Selection persistence:**

- If the selected event scrolls beyond `MAX_RENDERED_EVENTS`, selection
  **is retained**. The Store still owns the event; only one
  *representation* of it (the row) has left view. The inspector
  continues to reflect it.
- If a future filter excludes the selected event from the navigable
  set, selection **is cleared**, returning the inspector to its empty
  state. Continuing to show an event the list can no longer display
  would break the "inspector is a projection of the current selection
  *within the navigation context*" model — the two panes would
  describe different event sets.

In one sentence: **selection persists while the event exists in the
Store and remains part of the current navigation context; it is
cleared when explicitly replaced, or when the event is excluded from
that context (e.g. by a filter) — never merely because it scrolled out
of the rendered window.**

### Panel state model — Accepted: Panel-local state, delegated events, targeted updates

Three decisions, recorded together because they reinforce one another.

**1. `selectedEvent` lives in `panel.ts`**, alongside the existing
lifecycle state (`installed`, `unsubscribe`, `overlay`). Conceptually:

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
}
```

Whether this ends up as a literal object or a handful of closure
variables (matching the existing style in `panel.ts`) is an
implementation detail. Architecturally, it belongs to the Panel — not
the Store — for the same reason established in the Selection decision
above: selection is view state.

**2. Event delegation, not a per-row `onSelect` callback.** A single
delegated click handler on the event-list container — not
`createEventRow()` taking an `onSelect` prop — determines which event
was clicked and updates `selectedEvent`. This isn't primarily a
performance choice (there aren't enough rows for that to matter at
`MAX_RENDERED_EVENTS = 300`); it preserves `createEventRow()`'s single
responsibility ("given an event, produce a DOM representation") without
teaching it about selection, ownership, or Panel behavior.

**3. Selection changes do not trigger event-list reconstruction.**
This is a deliberate, narrow departure from ADR-0008's "just re-render
everything" stance — and worth explaining why it isn't a contradiction.
ADR-0008's simplicity applied to **Store changes**: the list had one
projection (Store → List), so a full re-render on every new event was
the correct, boring default. The architecture is no longer that
simple — the Store now has two independent projections:

```text
Store
      │
      ├──► List
      │
      └──► Inspector
```

Selection changing does not change the Store. The list has no new data
to show; only the inspector does. Applying "re-render everything" here
would mean rebuilding up to 300 rows on every click just to move a
highlight and swap the inspector's contents — that's not consistency
with ADR-0008, it's reapplying its rule outside the context it was
written for.

The resulting rule:

- **Store changes** → the event list re-renders (existing ADR-0008
  behavior, unchanged).
- **Selection changes** → the inspector renders the newly selected
  event; the list only updates the visual selected-row state (e.g. a
  `data-selected` attribute toggle) — it does not reconstruct rows.

**Invariant to record:** selection changes are UI state transitions.
They do not trigger event-list reconstruction unless the underlying
Store contents change. The exact mechanism (`classList.toggle()`,
`data-selected`, cached DOM references) is an implementation concern,
not a spec concern.

This also clarifies the emerging component boundary, though it doesn't
require its own ADR — it's implementation structure growing naturally
out of the decisions above, not a new architectural commitment:

```text
panel.ts     — owns selectedEvent, install(), subscriptions, delegation
renderer.ts  — owns rendering the event list, updating selection visuals
inspector.ts — owns rendering the currently selected event (new file)
```

## User stories

As a developer using an app with DevLens embedded...

- ...I want to click an event row and see its full stack trace, so I
  can find the failing line without opening devtools.
- ...I want to see an event's `metadata`/`context`/`tags`, so I can
  understand what the plugin captured beyond the summary line.
- ...I want to narrow the event list to a specific category or
  severity, so I'm not scrolling past noise to find what I care about.
- ...I want to search event text, so I can find a specific error
  message in a long session.
- ...I want to pause capture, so the list stops scrolling while I read
  something.
- ...I want to export the current session as JSON, so I can share a
  bug report without asking someone to reproduce it live.

*(To be expanded/refined during Session 4 design discussion — this is
a starting set, not exhaustive.)*

## Open questions

None of the following have been decided. They should be resolved one
at a time during Session 4 design discussion, not assumed by whoever
implements first.

- **Filtering model:** are filters additive (AND) or a single active
  category/severity at a time? Does filtering hide non-matching events
  or just visually de-emphasize them?
- **Search scope:** does search match title/message only, or also
  stack/metadata/tags? Is it substring match, or something fuzzier?
- **Keyboard navigation:** are there keyboard shortcuts at all for v1
  (ADR-0008 explicitly deferred these for the base Panel), and if so,
  what's the minimal set?
- **Pause/resume semantics:** does "pause" stop the Store from
  receiving new events, or just stop the Panel from rendering them
  (Store keeps accumulating in the background)? These have different
  memory/`MAX_RENDERED_EVENTS` implications.
- **Export format:** raw `DevLensEvent[]` as JSON, or a wrapped format
  with session metadata (start/end time, DevLens version)? Does import
  need to validate/version-check what it's given?

## Constraints

Derived from existing ADRs, not up for revisiting casually:

- **Shadow DOM isolation** (ADR-0008) — any new UI (drawer, toolbar,
  search input) mounts inside the existing Panel's Shadow Root, not as
  a separate host element.
- **Vanilla DOM, no framework** (ADR-0008) — inspection UI follows the
  same incremental-DOM-update approach already used for event rows.
- **Store as read-only for Panel** (ADR-0004, ADR-0008) — Panel/
  inspection reads from `EventStore`, never mutates it or introduces a
  parallel state store for the "same" data.
- **Plugin independence** — none of this should require Runtime or
  Console to change; inspection operates entirely on data already in
  `DevLensEvent`.
- **Rendering performance** — `MAX_RENDERED_EVENTS` and the "renderer
  owns the whole ShadowRoot" limitation (ADR-0008) are known
  constraints inspection will likely bump into; see the flagged items
  in ADR-0009's Consequences section. Resolving the ShadowRoot/renderer
  container split is expected to become its own ADR-0008 amendment
  once inspection's actual DOM structure is designed — not something
  to decide inside this spec.

## Proposed milestones

Rough phases, not commitments — sequencing may change if later Open
Questions surface something that forces revisiting an earlier phase:

- **Phase 1 — unblocked, ready for implementation.** Presentation,
  Selection, and Panel state model are all decided (see Session 4
  decisions above). Persistent inspector region, single-selection via
  delegated click handling, targeted (not full-list) re-render on
  selection change, full event data shown (stack/metadata/context/tags).
- **Phase 2:** Filtering by category/severity. Blocked on the Filtering
  model open question.
- **Phase 3:** Search. Blocked on the Search scope open question.
- **Phase 4:** Pause/resume, clear, export/import. Blocked on the
  Pause/resume semantics and Export semantics open questions.

## Future extensions

Noted for later, explicitly out of scope now:

- Multi-event comparison / diffing.
- Saved filter presets.
- Timeline/waterfall view (likely belongs to Network capture, not this
  spec).
