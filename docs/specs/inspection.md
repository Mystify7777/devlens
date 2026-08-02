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

### Filtering model — Accepted: faceted (AND-across/OR-within), hide, Panel-local, filter-before-window

Four sub-decisions, recorded together because — like the Panel state
model — they only make sense as a set.

**1. Dimensions combine with AND; values within a dimension combine
with OR.** Filtering is scoped to category and severity (per
ADR-0009). Selecting multiple values within one dimension (e.g.
severity = error, warn) is a widening operation — either matches.
Selecting values across dimensions (severity = error AND category =
network) is a narrowing operation — both must match. An unset
dimension imposes no constraint (equivalent to "all values selected").

```text
event passes ⟺
  (event.severity ∈ selectedSeverities ∨ selectedSeverities is empty)
  ∧
  (event.category ∈ selectedCategories ∨ selectedCategories is empty)
```

This generalizes cleanly to future dimensions (origin, tags, plugin)
without redesigning the combination rule — a new dimension is just
another clause ANDed in.

**Rejected: single active filter at a time.** Doesn't compose — every
new filter type would compete for ownership of "the" active filter,
and turning one on would silently discard another the developer just
set. That's worse UX than two independent sets, for no real
implementation savings.

**2. Non-matching events are hidden, not de-emphasized.** They are
absent from the rendered list, not present-but-dimmed.

**Rejected: de-emphasize (grey out, keep rendered).** Fails the
purpose test: filtering exists to reduce scanning cost (see
Principles — "the list is still the primary navigation surface"), and
a de-emphasized-but-present row doesn't reduce it. It also collides
with `MAX_RENDERED_EVENTS`: if de-emphasized events still occupy a
rendered slot, filtering can make the events you *do* want harder to
find inside the 300-row budget — the opposite of the feature's intent.

**3. Filter state is Panel-local UI state, never Store state** — the
same reasoning as Selection. The Store answers "what exists"; a
category/severity filter, like `selectedEvent`, is "what the developer
is currently choosing to look at," and belongs to the consumer (Panel),
not to a data structure a future CLI or other integration would also
inherit. Selection and filters are siblings in the same conceptual
state:

```ts
interface PanelState {
  selectedEvent: DevLensEvent | null;
  filters: FilterState;
}
```
(Illustrative shape, not a commitment to a literal object over closure
variables — same caveat as the Panel state model decision above.)

**4. Filtering is applied to the full Store, before
`MAX_RENDERED_EVENTS` windowing — not applied within an
already-windowed slice.** Today, `panel.ts` computes
`store.getAll().slice(-MAX_RENDERED_EVENTS)` and renders that directly.
Once a filter exists, the order matters:

- **Filter-then-window (accepted):** filter the full Store, then take
  the last `MAX_RENDERED_EVENTS` *matching* events. A "severity: error"
  filter shows your most recent errors, however far back they occurred.
- **Window-then-filter (rejected):** take the last 300 events, then
  filter within that slice. A "severity: error" filter could show
  *nothing* — not because no errors exist, but because none happened
  to fall inside an unrelated, invisible windowing limit the developer
  has no way to know about. That's not a smaller result set, it's an
  incorrect one: the UI would be silently lying about what the Store
  contains.

This means `panel.ts`'s existing slicing logic moves to *after*
filtering rather than before — a small, contained change to something
already documented as Panel's responsibility (not the renderer's,
which stays purely mechanical per the ADR-0008 amendment above).

#### A concept this discussion surfaced: Navigation Context

Filtering makes explicit something that's existed implicitly since the
Selection decision: there's a stage between "what the Store contains"
and "what's actually rendered."

> **Navigation Context:** the ordered collection of events currently
> available for navigation — the *result* of applying zero or more
> view-level transformations (filtering, and later search) to the
> Store's contents, before presentation constraints like
> `MAX_RENDERED_EVENTS` are applied.

Precisely: Navigation Context is a **result**, not a transformation
step. `applyFilters()` is the transformation; the array it returns is
*a* Navigation Context. This matters once Search exists — Search
doesn't operate "inside" some single Navigation Context stage, it
takes one Navigation Context (the output of filtering) and produces
another. Each pure transformation produces its own Navigation Context;
there can be more than one in a pipeline, not one fixed stage all
transformations share:

```text
Store
  │
  ▼
applyFilters()
  │
  ▼
Navigation Context  (result of filtering)
  │
  ▼
applySearch()   (future)
  │
  ▼
Navigation Context  (result of filtering + search)
  │
  ▼
window()  (MAX_RENDERED_EVENTS — presentation constraint, not a
           transformation of the Navigation Context, a slice of it)
  │
  ▼
Renderer
```

This gives a name to the thing Selection's persistence rule was
already describing without naming it — "cleared... when the event is
excluded from that context (e.g. by a filter)" (see Selection model,
above) *is* a statement about a Navigation Context, written before the
term existed. Once named, future features can be specified against it
directly rather than re-deriving the pipeline each time:

- **Search**, once designed, takes the Navigation Context that
  filtering produced and returns a narrower one — not a second,
  parallel mechanism.
- **Keyboard navigation** (next/previous/page up/down), if it exists,
  moves through the current Navigation Context, not the Store and not
  the rendered DOM window directly.
- **Export**, per the existing "Implications to preserve" under
  Presentation model, operates on the Store (or an explicitly filtered
  view of it) — a deliberate exception, since exporting is about
  session data, not the developer's current navigation state.

**Invariant: every transformation that produces a Navigation Context
must be a pure function.** `applyFilters(events, filters)` takes an
event array and a filter state and returns an event array — no
renderer, no DOM, no selection logic, no side effects. This keeps it
trivially unit-testable in isolation from Panel/Renderer, and means
Search later composes as `applySearch(applyFilters(events, filters),
query)` — each transformation stays independent and pure, only the
final result gets windowed and handed to the renderer.

**Invariant: filtering is order-independent (commutative) across
dimensions.** Given the AND-across-dimensions design already accepted,
applying the category filter and then the severity filter must produce
the same result as applying them in the reverse order, and the same
result as applying both at once:

```text
applyFilters(events, {categories: A, severities: B})
  ==
applyFilters(applyFilters(events, {categories: A}), {severities: B})
  ==
applyFilters(applyFilters(events, {severities: B}), {categories: A})
```

This falls out naturally from the AND/OR combination rule already
decided — no extra implementation work is required — but it's worth
stating explicitly: it tells future implementers that filters are a
**declarative constraint** (a predicate an event either satisfies or
doesn't), not a **procedural pipeline** where sequence matters. A
future dimension (e.g. a text search) that *isn't* order-independent
with the others would be a deliberate, notable exception, not a silent
one.

**Scope note: filter engine vs. filter controls.** This section
decides the filter *engine* — `FilterState`'s shape and
`applyFilters()`'s behavior — as pure, DOM-free logic. It deliberately
does **not** decide filter *controls* — whatever UI lets a developer
actually set `filters` (toolbar, dropdown, chips, keyboard shortcut).
That's a Presentation-layer concern, decided separately, likely as its
own small ADR-0008 amendment once it's being built. Keeping these
separate avoids coupling the filter engine to whichever UI happens to
be designed first — the same reason `renderer.ts` knows nothing about
click handling or selection ownership (see Panel state model, above).

**Rendering consequence.** Selection changes deliberately skip
`renderEventList()` (see Panel state model, above) because Store
membership doesn't change. Filtering is the opposite case: it changes
which events are in the Navigation Context, which is exactly the
condition that already triggers a full list re-render today (a Store
change). So a filter change goes through the *existing* `Store change →
renderEventList()` path — this isn't a new rendering mode, it's the
current one, invoked for a new reason:

```text
filter changed
  → recompute Navigation Context (applyFilters, pure)
  → window to MAX_RENDERED_EVENTS
  → renderEventList(windowed events)
  → re-apply selection: if selectedEvent still in Navigation Context,
    setSelectedRow(); otherwise selectEvent(null) — per the Selection
    persistence rule already recorded above
```

### Filter controls model — Accepted: toolbar above the list, immediate apply, checkbox groups

Three decisions, following the same pattern as every prior Session 4
decision — recorded together since, like Panel state and Filtering
model, they only make sense as a set.

**1. Placement: a toolbar region above the event list, not above the
whole Panel.** Filtering changes navigation (which events are
browsable); it has no relationship to inspection. Scoping the toolbar
visually and structurally to the list — not spanning the inspector
too — keeps that boundary honest. See ADR-0008's Session 5 amendment
for the resulting ShadowRoot region structure.

**2. Apply immediately, no "Apply" button.** Every checkbox toggle
calls `setFilters()` directly; there is no intermediate "draft
filters" state a developer has to commit. `applyFilters()` being pure
and cheap is what makes this affordable — recomputing the Navigation
Context on every toggle costs nothing worth guarding behind an
explicit commit step. An Apply button would introduce a second piece
of state (draft vs. active filters) that duplicates a decision this
project already made once with Selection ("no arrays, no sets, no
extra state the simplest model doesn't need") for no evidenced benefit.

**3. Checkbox groups, not dropdowns**, one group per dimension
(Severity, Category). A dropdown typically implies "pick one";
checkboxes directly communicate the OR-within-a-dimension behavior
already decided in the Filtering model — seeing multiple boxes checked
*is* the mental model, rather than something a developer has to infer.

**Architectural constraint carried over from the Filtering model: the
toolbar never calls `applyFilters()`.** Its only outward call is
`panel.setFilters(filters)` — it does not know the filtering engine
exists beyond the shape of `FilterState` it must construct. This keeps
the dependency graph one-directional and each layer talking only to
its immediate neighbor:

```text
Toolbar → panel.setFilters() → updateEventList()
        → computeNavigationContext() → applyFilters()
```

A future control-surface redesign (chips, a different grouping, a
search-adjacent filter bar) only ever has to satisfy this same seam —
it never needs to know how filtering is computed.

**Deferred cleanup, explicitly not done now:** the click handler that
resolves a clicked row back to an event still searches
`store.getAll()` rather than the current Navigation Context. This is
harmless today (a click can only land on a row that's already in the
Navigation Context, since that's what was rendered), but it's a seam
worth tightening once Search exists and "what's clickable" and "what's
in the Store" can diverge more meaningfully. Noted here rather than
fixed now, per the project's discipline against unforced changes.

### Search model — Accepted: developer-facing text fields, trimmed case-insensitive substring, pure engine before controls

Four decisions, following the same pattern as Filtering — recorded
together because, like the Filtering model, they only make sense as a
set. Search is a second, independent transformation on the Navigation
Context, not a special case bolted onto Filtering.

**1. Scope: title, message, stack, and tags — developer-facing
textual content, not arbitrary structured payloads.** These are the
fields a developer reads to understand what happened, or explicitly
chose as short lookup labels (tags). This is deliberately phrased as a
principle rather than a fixed field list, so it scales if a future
event shape adds another human-authored text field without requiring
a redesign.

**Rejected: also search `metadata`/`context`.** These are open,
structured key-value data — arbitrary numbers, booleans, nested
objects, rendered generically by the Inspector. Substring-matching a
stringified value produces answers with no principled basis (should
searching `"true"` match every event with any boolean-`true` metadata
value? should `"3"` match a `retryCount` of `3`, or a stack line
number, or neither?). Structured fields already have a structured way
to narrow them — Filtering — and Search deliberately doesn't duplicate
that with a blunter, textual version of the same capability.

**2. Match semantics: trimmed, case-insensitive substring match on
the whole query string.** Leading/trailing whitespace is stripped
before matching, so `"runtime error"` and `" runtime error "` behave
identically — a small friendliness guarantee that costs nothing and
keeps the function fully deterministic.

**Rejected: fuzzy matching.** Requires selecting and tuning an
algorithm (or a dependency) for a need nothing in this project has
yet demonstrated — the same "no speculative abstraction" reasoning
that killed `assert.ts`/`now()` in Core.
**Rejected: regex.** Real footgun (unbounded/backtracking patterns
from arbitrary developer input) and immediately raises unresolved
questions with no good default (does `"("` throw? auto-escape?
silently fail to match?) — that's designing a regex engine, not a
diagnostics tool.
**Deferred, not rejected: multi-term AND-token matching** (e.g.
`"error network"` matching a field containing both words, in either
order). Genuinely useful eventually; whole-string substring is
simpler to build and test first, and multi-term search is additive
later, not a rewrite.

**3. Composition: Search is a second transformation on the Navigation
Context, applied after Filtering.** This was already committed to
when Navigation Context was named (see Filtering model, above) —
Search doesn't need a new decision here, only confirmation that it
holds:

```text
Store
  │
  ▼
applyFilters()
  │
  ▼
Navigation Context  (result of filtering)
  │
  ▼
applySearch()
  │
  ▼
Navigation Context  (result of filtering + search)
  │
  ▼
window()
  │
  ▼
Renderer
```

**4. Engine before controls — stated as an explicit architectural
principle, not just a build order.** The search engine has no
knowledge of text inputs, focus, keyboard events, rendering, or
highlighting. It knows only `applySearch(events, query): DevLensEvent[]`.
Search *input* (a text field), *match highlighting* (decorating
matched substrings in rendered rows/inspector text), and *keyboard
navigation* (traversing the Navigation Context — a Navigation concern,
not a Search one; explicitly un-bundled from this milestone) are each
separate, later slices, following the exact engine-then-controls
sequence Filtering already proved out:

```text
Search engine  →  Panel integration  →  Search controls  →
Highlighting  →  Keyboard navigation
```

Highlighting in particular is two nearly-independent responsibilities
— Search locates matches and narrows the Navigation Context; rendering
decorates matched text — and disabling highlighting entirely wouldn't
change whether Search functions correctly. That independence is the
signal they're different slices, not one feature.

#### Search invariants

Mirroring the commutativity invariant recorded for Filtering:

- **Pure.** `applySearch(events, query)` takes an event array and a
  string, returns an event array — no DOM, no renderer, no side
  effects, same as `applyFilters()`.
- **Empty query is the identity transformation.** `applySearch(events, "")`
  (after trimming) returns `events.slice()` — a fresh array, same
  members, same order. Same philosophy as `applyFilters()`'s
  no-active-filters fast path.
- **Order-preserving.** Matching events are returned in their original
  relative order, same as `applyFilters()`.
- **Never mutates** either argument.
- **Idempotent for the same query.** `applySearch(applySearch(events, q), q)`
  equals `applySearch(events, q)` — searching twice with the same
  query doesn't continue narrowing anything further, which falls out
  naturally from being a pure predicate over already-matching events,
  but is worth stating explicitly the same way commutativity was for
  Filtering.

### Search controls model — Accepted: no debounce, update on every keystroke, separate component from the toolbar

**1. No debounce.** `setSearchQuery()` is called on every keystroke
(the input's `input` event), with no delay. `applySearch()`,
`applyFilters()`, and windowing are all linear scans over in-memory
arrays bounded by realistic event volumes; recomputing the Navigation
Context on every character of a five-character query is a handful of
cheap operations, not a performance concern. Debounce would introduce
real design questions (how many milliseconds? does Enter bypass it?
does blur flush it? IME composition?) to solve a problem that doesn't
exist yet — the same "don't solve tomorrow's performance problem with
today's complexity" principle that kept `applyFilters()` and
`applySearch()` free of premature optimization. If DevLens ever
handles event volumes where this stops being true, that's a windowing/
indexing problem to solve then, not a reason to add input latency now.

**2. The search box is its own component, not folded into the
toolbar.** `createSearchBox(onQueryChange)` lives beside
`createToolbar(onFiltersChange)`, not inside it. They're both filter
*controls* in the broad sense (both narrow the Navigation Context, both
sit above the event list, per the Filtering model's placement
rationale), but they drive independent state (`filters` vs.
`searchQuery`) through independent seams (`setFilters()` vs.
`setSearchQuery()`), and mixing them into one component would blur
that. See ADR-0008's Session 6 amendment for the resulting region
structure.

**Scope note, mirroring Filtering's engine/controls split: Search
*presentation* is explicitly not decided here.** Match highlighting
(in the list, the inspector, or both), a "no results" empty state
distinct from "nothing selected," and a match count are all
rendering concerns layered on top of a Navigation Context that's
already correctly narrowed — the search box above proves the engine
and controls work without any of them. These get their own short
design pass before being built, the same way Filter controls got one
separate from the Filtering engine.

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

- **Keyboard navigation:** a Navigation concern, not a Search one (see
  Search model, decision 4) — traverses whatever the current
  Navigation Context is, independent of whether narrowing came from a
  filter, a search, both, or neither. Deliberately sequenced after
  Search controls/highlighting, not bundled into this milestone. Still
  open: are there keyboard shortcuts at all for v1 (ADR-0008 explicitly
  deferred these for the base Panel), and if so, what's the minimal set?
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
- **Phase 2 — complete.** Filtering model and Filter controls model
  are both decided and implemented (see Session 4 decisions above):
  faceted category/severity filters (AND across dimensions, OR
  within), hide (not de-emphasize) non-matching events, Panel-local
  filter state, filter-before-window against the Navigation Context,
  and a checkbox-group toolbar above the event list that calls
  `setFilters()` and nothing else.
- **Phase 3 — engine and controls complete; presentation not started.**
  Search model and Search controls model are both decided (see Session
  4 decisions above): title/message/stack/tags scope, trimmed
  case-insensitive substring match applied after Filtering, a
  dedicated search-box component (no debounce) alongside the toolbar.
  Match highlighting, a distinct "no results" state, and a match count
  are Search *presentation* — deliberately not scoped to this phase,
  pending their own short design pass.
- **Phase 4:** Pause/resume, clear, export/import. Blocked on the
  Pause/resume semantics and Export semantics open questions.

## Future extensions

Noted for later, explicitly out of scope now:

- Multi-event comparison / diffing.
- Saved filter presets.
- Timeline/waterfall view (likely belongs to Network capture, not this
  spec).
- A floating trigger + expand/collapse toggle for the whole Panel
  (show/hide the entire overlay, not any one region within it). Carried
  over from ADR-0008's original Non-goals (v1) list; previously tracked
  only in a stale code comment in `overlay.ts`, moved here during the
  post-v0.3.0 review pass so it has one real home.
