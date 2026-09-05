# Research: Session Import

Status: research, not a decision record. Nothing here is Accepted or
Rejected — that happens in an ADR, if this document concludes one is
warranted. Every claim below about existing code was verified against
`packages/core` and `packages/panel` as they exist today, not assumed
from memory of earlier sessions. Where a claim is a design opinion
rather than a verified fact, it's labeled as such.

## Scope

Export (`serializeEvents()`) already exists and ships today. This
document is about the other direction: taking a previously exported
JSON file and getting its events back into a running DevLens Panel's
`EventStore`. It does not cover a UI for triggering import, cross-
session diffing, or merging two live sessions — those are downstream
of whatever integrity boundary this document identifies.

## Existing event construction contract

### The pipeline every first-party event currently goes through

```text
capture (Runtime / Console / Network)
      ↓
normalizer → DevLensEventInput
      ↓
EventBus.report(input)
      ↓
  id ?? generateEventId()
  version ?? 1
  timestamp ?? Date.now()
      ↓
  middleware pipeline (mutate-in-place or replace)
      ↓
  deepFreeze(finalDraft)
      ↓
  replayBuffer.push() + dispatch to subscribers
      ↓
connectStoreToBus() subscriber
      ↓
EventStore.add(event)
      ↓
  buffer.push(event) + notify(event)
```

Two things about this pipeline matter more than they first appear to.

**`EventBus.report()` performs no runtime shape validation.** Reading
the implementation directly: it spreads `input` into a draft object,
defaults `id`/`version`/`timestamp` if absent, runs middleware, deep-
freezes the result, and returns it. Nothing checks that `severity` is
one of the six valid values, that `category`/`title`/`message` are
actually strings, or that `metadata`/`context` are plain objects
rather than, say, a class instance or `null`. The entire system has
only ever depended on **compile-time TypeScript trust** — every caller
of `report()` is first-party code the type checker already
constrains. There is no first-party consumer this has ever needed to
enforce at runtime, because nothing untrusted has ever called it.

**`EventStore.add()` performs even less.** It takes a `DevLensEvent`
and pushes it into a `RingBuffer`, then calls `notify()`. No freezing,
no defaulting, no validation, nothing. The Store's own type signature
requires a full `DevLensEvent` (not a `DevLensEventInput`), so in a
type-checked first-party call site this is fine — by the time
anything reaches `store.add()`, it has already been through
`report()`. But `add()` itself enforces none of that at runtime; it's
trusting its caller exactly as much as `report()` trusts its own
callers.

**`deepFreeze()` freezes plain objects/arrays recursively**, skips
host/built-in objects (`Date`, `Map`, `RegExp`, DOM nodes, functions,
etc. — deliberately, since freezing those can have side effects), and
is cycle-safe via a `WeakSet`. It is a pure, already-tested utility
with no dependency on the Bus — reusable as-is for Import if reuse
turns out to be the right call.

**`generateEventId()`** prefers `crypto.randomUUID()`, falling back to
a `Date.now()` + random-suffix string. Relevant because it means
`id` collisions are already possible in principle (fallback path,
though vanishingly unlikely) — the system doesn't currently guarantee
global uniqueness, only extremely-high-probability uniqueness. Worth
knowing before Import treats `id` collisions as an impossible case.

### `DevLensEvent` — the actual shape

```ts
interface DevLensEvent {
  readonly id: string;
  readonly version: 1; // literal 1, not `number`
  readonly origin: string;
  readonly category: EventCategory; // BuiltinEventCategory | (string & {})
  readonly severity: EventSeverity; // closed union, 6 values
  readonly title: string;
  readonly message: string;
  readonly timestamp: number;
  readonly stack?: string;
  readonly metadata?: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
  readonly tags?: string[];
}
```

`version` is currently a TypeScript literal type (`1`), not an enum
with multiple members. At the type level there is exactly one version
that has ever existed. `DevLensEventInput` (the shape `report()`
accepts) makes `id`/`timestamp`/`version` optional, everything else
required — this is the authoritative "what does a valid event need"
contract, and Import's validator should check against this shape, not
invent a parallel one.

`category` is a hybrid type (`BuiltinEventCategory | (string & {})`)
by design, so "is this a valid category" isn't a closed check the way
`severity` is — any string is technically a legal category today, for
plugin extensibility. Import's validator needs to know this isn't a
gap to close; it's an intentional openness already present in the
live system.

## Existing export contract

`serializeEvents()` (`packages/panel/src/serialize.ts`) is
deliberately minimal, per its own doc comment: `JSON.stringify(events,
null, 2)` on whatever array it's given (in practice, `store.getAll()`
— all events, ignoring active filters/search/pause, per the Session 7
Export decision). No wrapper object, no schema-version field at the
document level, no session metadata (export time, DevLens version,
user agent, etc.). The output is exactly a JSON array of
`DevLensEvent` objects, each already carrying its own `id`, `version:
1`, and original `timestamp` from when it was first captured.

This matters for Import in a specific way: **there is no
document-level version to check.** Only each individual event's own
`version` field exists. A "does this whole file's schema match what I
can import" question has nothing to read today except inferring it
from the first event, or every event, in the array.

## Import trust boundary

### What `JSON.parse()` guarantees

Only that the text is syntactically valid JSON and produces some
combination of objects, arrays, strings, numbers, booleans, and
`null`. It guarantees nothing about _shape_ — a syntactically valid
JSON file can be `{}`, `[1, 2, 3]`, or a 50MB array of objects with
none of `DevLensEvent`'s required fields.

### What it does not guarantee, specifically for this shape

- Top level is an array at all (could be an object, a primitive, `null`)
- Array elements are objects (could be strings, numbers, nested arrays)
- Required string fields (`id`, `origin`, `title`, `message`) are
  actually strings, not numbers/`null`/missing
- `severity` is one of the six literal values, not an arbitrary string
- `version` is the literal `1`
- `timestamp` is a finite number, not `NaN`, a string, or missing
- `metadata`/`context`, if present, are plain objects (not arrays,
  class instances, or primitives) — the same shape `deepFreeze()`
  already assumes for anything it's asked to freeze
- `tags`, if present, is an array of strings specifically, not an
  array of arbitrary JSON values
- `id` values are unique within the imported file, and don't collide
  with `id`s already in the live Store

None of this is exotic — it's the ordinary "parsing beats validating"
gap every system has at an external-input boundary. DevLens has
simply never had one before now.

## Integrity requirements (what the research surfaces, not what's decided)

Per-field, grounded in the `DevLensEvent`/`DevLensEventInput` contract
above:

| Concern                               | Existing precedent                                 | Applies to Import?                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`/`version`/`timestamp` defaulting | `report()` does this today                         | Not directly — imported events already _have_ these values, and regenerating them would discard the original capture identity/time, defeating the purpose of importing a past session |
| Deep immutability                     | `deepFreeze()`, applied by `report()`              | Yes, unmodified reuse — freezing is source-agnostic                                                                                                                                   |
| Shape/type validation                 | **Does not exist anywhere in the codebase today**  | Yes — this is net-new work, not reuse                                                                                                                                                 |
| `severity` enum check                 | TypeScript-only today                              | Needs a runtime check for Import specifically                                                                                                                                         |
| `id` collision handling               | Not handled anywhere (Bus/Store assume good faith) | Open — first time this question has ever needed an answer                                                                                                                             |
| Bulk-insertion ordering               | `RingBuffer` is FIFO, no timestamp sort            | Open — importing an old session into a Store with live events interleaves by insertion order, not by `timestamp`                                                                      |
| Notification volume                   | `store.add()` calls `notify()` once per event      | Open — importing N events fires N synchronous Panel re-renders unless something batches it                                                                                            |

## Failure semantics

Two shapes worth naming explicitly, not choosing between yet:

**Whole-import rejection.** One malformed event anywhere in the file
fails the entire import; the Store is left untouched. Simpler
mental model ("this file is either a valid session or it isn't"),
matches how a corrupt file is usually treated elsewhere. Costs the
user the entire file if even one event, out of possibly thousands,
is malformed.

**Per-event rejection.** Valid events are imported; malformed ones are
skipped and reported (console warning, a returned list of skip
reasons, or similar). More forgiving of partially-corrupt files or
hand-edited exports. Costs a decision about _how_ skip results are
surfaced to the person doing the import, which is itself a small
design question, not a given.

## Schema versioning

`version: 1` exists on every event today but is **read by nothing** —
no code path branches on its value. It is, right now, purely
descriptive metadata that happens to be present.

Import is the first feature that could give it an actual job:

```text
today:     version is written, never read
Import:    version could be read and checked for the first time
```

Two distinct postures, not yet chosen between:

1. **Treat it as inert today.** Import accepts any event whose shape
   otherwise matches `DevLensEvent`, ignores the `version` field's
   value entirely (same as everything else currently does). Defers
   the "what does a version mismatch even mean" question until there
   are two versions to compare — consistent with the project's
   standing discipline against building for a case that doesn't exist
   yet.
2. **Treat it as a compatibility contract starting now.** Import
   explicitly checks `version === 1` and rejects (or flags) anything
   else, even though nothing else in the system has ever produced or
   would currently produce a different value. Establishes the
   contract before it's tested by a real second version, at the cost
   of writing a check that, today, can never actually fail.

This document is not choosing between these — flagging that it's a
real fork, not a formality, and that whichever is chosen, **a
migration framework is explicitly out of scope** regardless (there is
only one version; there is nothing to migrate between yet).

## Architectural options (not decisions)

**A. Import validates + freezes, then calls `EventStore.add()`
directly.** A new, narrow `validateImportedEvent()` (or similar) leaf
function checks shape against the `DevLensEvent` contract; on success,
`deepFreeze()` (reused, unmodified, from Core) is applied, then
`store.add()`. Bypasses `EventBus.report()` entirely — deliberately,
since `report()` would regenerate `id`/`timestamp`, destroying the
imported event's original identity. Keeps Core and the Bus completely
unchanged. Matches the Store's own doc comment, which already
anticipated "an imported session file" as a legitimate direct Store
source, independent of the Bus.

**B. `EventStore` grows its own validation.** `add()` itself becomes
the integrity boundary — validates and freezes any event handed to
it, not just ones coming through Import. Would mean every existing
call site (`connectStoreToBus()`, tests) pays a validation cost that,
today, is redundant (events arriving via the Bus are already valid by
construction). Also a bigger blast radius than the problem requires —
changes a Core primitive's contract to solve a Panel/Import-level
problem. Doesn't obviously buy anything Option A doesn't, at a higher
cost.

**C. Bus-based import.** Feed imported events through
`EventBus.report()` somehow, reusing its middleware/freeze pipeline.
Rejected by the identity problem above — `report()`'s entire job is
assigning identity to _new_ occurrences; an imported event is by
definition not new. Forcing it through `report()` would need a special
"don't regenerate identity" mode that doesn't exist and would only
ever be used by Import, which is just Option A with extra
indirection.

**D. A dedicated Import package/module with its own small pipeline**,
structurally mirroring how `@devlens/network` got its own
`types.ts`/normalizer/classifier rather than bolting onto an existing
package. Whether Import deserves this much structure, or is small
enough to live inside `@devlens/panel` next to `serialize.ts`, is an
open question below — not resolved by this document.

Option A is the only one of these that requires zero changes to Core
or the Bus, and it's the option the Store's own existing documentation
already gestures at. It's also, notably, the same shape of conclusion
Network's research arrived at (Candidate A there: the option that
required no Core changes won on that basis too) — worth naming as a
pattern, not just a coincidence: every capture-adjacent decision this
project has made has favored leaving Core immutable/append-only and
absorbing complexity at the edge instead.

## Findings

Reviewed and settled (2026-08-14). Recorded as agreed, including the
scoping/emphasis refinements from that review — not just the original
draft.

1. **The existing pipeline trusts first-party callers; this is scoped
   to the event pipeline specifically, not a defect in Core.** Neither
   `EventBus.report()` nor `EventStore.add()` performs runtime shape
   validation today. This has been correct and sufficient because
   every producer has been trusted, type-checked, first-party code.
   Import is the first feature that changes the trust model itself —
   the absence of validation isn't a gap being discovered, it's a
   design that was appropriate for a closed set of producers and is
   now being asked to admit an open one.
2. **`deepFreeze()` is reusable, but freezing is not validation — and
   the research note should keep these explicitly separate.**
   ```text
   parse → validate shape/semantics → deepFreeze → store.add
   ```
   `deepFreeze()` guarantees immutability of whatever object it's
   given. It cannot tell us `severity: 47` is invalid, or that
   `metadata` is a string instead of an object. Reuse of `deepFreeze()`
   answers only the third step above; it says nothing about the
   second.
3. **Routing imported events through `EventBus.report()` is
   disqualified — recorded as a constraint, not a rejected option
   among several.** `report()` regenerates `id`/`timestamp`, and the
   original values are part of the historical event being restored;
   regenerating them changes the object's meaning. `report()` is
   structurally the wrong boundary for this input, not merely an
   unnecessary detour.
4. **The Store seam is legitimate, not newly invented.** The Store's
   own existing documentation already anticipates an imported session
   as a direct source, independent of the Bus. This is evidence the
   decoupled Store/Bus design (ADR-0004) already intended to
   accommodate this, not a new ownership model being proposed now.
5. **`version: 1` is currently inert (written, never read), and Import
   is the first feature where it needs an explicit, real meaning** —
   without letting that turn into a migration system prematurely. The
   likely shape is narrow ("Import accepts version 1, rejects
   anything else"), but that conclusion belongs in the open decisions,
   not asserted here.
6. **Export produces no document-level schema metadata** — only
   individual events, each carrying their own (currently unused)
   `version` field. Any future "is this export file compatible"
   question has nothing else to read from.
7. **Bulk import exposes real semantics, not implementation
   optimization details:**
   ```text
   imported events + existing live events → insertion order ≠ chronological order
   N imported events → N store notifications → N synchronous recomputations/renders
   ```
   Both need to be considered as part of defining the Import
   operation itself, not deferred as a later performance pass.
8. **Import cannot be treated as `forEach(store.add)` without a
   deliberate decision.** Finding 7 has a direct consequence: if
   expected import size can be substantial, then repeated `add()`
   calls make per-event notification part of Import's _observable_
   behavior, not just its internal implementation. This raises,
   without yet resolving, whether the Store needs a batch entry point
   (`addMany()`-shaped, one notification after the batch) versus
   Import simply accepting N notifications as correct. Not decided
   here — deliberately deferred to the open decisions below, after
   import semantics are established.

## Architectural decision (settled 2026-08-14)

**Option A accepted.** Option B rejected for this milestone (widens a
Core primitive's contract to solve a problem that's specific to
Import's trust boundary, not to the Store itself). Option C rejected
definitively (Finding 3 — destroys imported identity, not a close
call). Option D is not a competing architecture — it's a packaging
question layered on top of A, addressed separately below.

```text
                 Trusted first-party producers
                          │
                          ▼
                    EventBus.report()
                          │
                          ▼
                       Store

External session ──→ Import integrity gate ──→ Store
```

```text
Import boundary
  parse
    ↓
  validateImportedEvents()
    ↓
  deepFreeze() (each event)
    ↓
EventStore.addMany()
```

Note: this diagram is updated post-#8 to reflect the actual bulk path
— `EventStore.add()` remains the primitive for single-event insertion
(used by `connectStoreToBus()` for first-party capture, unchanged),
while Import specifically uses `EventStore.addMany()` (settled below)
for its one-shot, whole-session insertion. The validator name is
likewise pluralized (`validateImportedEvents()`, operating on the
array) to match the atomic, whole-import contract settled in Failure
Semantics — not because the per-event checks themselves changed.

Rationale:

- **Preserves existing ownership boundaries.** The Store stays a
  storage primitive — it owns data, not validation policy. Import
  owns the new trust boundary that only exists because external
  session data is untrusted; that responsibility belongs at the edge
  that introduces it, not retrofitted onto the Store.
- **Preserves historical identity.** A direct `store.add()` call keeps
  the imported event's original `id`/`timestamp`/`version` exactly as
  captured. This is the direct, concrete reason Option C (Bus-routed)
  is disqualified rather than merely disfavored.
- **No Core contract expansion.** Option B would change
  `store.add(event)` from "store this already-valid event" to "accept
  arbitrary external data and establish whether it's a valid event" —
  a real semantic widening of a low-level primitive, done only to
  serve a need Import itself creates.
- **Keeps the trust boundary visible.** Two legitimate paths into the
  Store now exist, each with its own upstream integrity guarantee
  (Bus for first-party capture, Import's own gate for external
  sessions) — clearer than forcing everything through one shared gate
  that wasn't designed for both cases.

**Qualification carried forward, not yet resolved:** the validator's
return shape is an open question, not settled by choosing Option A.
Candidates — a boolean, the validated `DevLensEvent` on success (throw
or return null on failure), or a richer result type that explains
_why_ an event failed — are deferred to the Failure Semantics decision
below, since the right shape depends on whether failure is
whole-import or per-event. Also carried forward: `deepFreeze()` is
composed by the Import layer, not folded into
`validateImportedEvent()` itself — validation and freezing stay two
separate steps, per Finding 2, not merged into one "integrity"
function.

**Where Import's code lives (settled 2026-08-14):** inside
`@devlens/panel`, alongside `serialize.ts` — not a dedicated package.

The distinguishing test isn't "does this put events into the Store"
(every capture source does that) — it's **architectural role**:
whether the capability independently _observes the host environment_
(Runtime/Console/Network all do — hence their own packages, own
`install()`/`uninstall()` lifecycle, own public contract) versus
whether it _operates on a session representation DevLens itself
already produced_ (Import's only input is DevLens's own Export
output — it observes nothing, has no lifecycle, and is Panel-triggered
rather than independently running).

|                            | Network                    | Import                                               |
| -------------------------- | -------------------------- | ---------------------------------------------------- |
| Live capture mechanism     | Yes                        | No — one-shot session operation                      |
| Source of data             | Browser API interception   | External file, produced by DevLens's own Export      |
| Lifecycle                  | `install()`/`uninstall()`  | None                                                 |
| Natural counterpart        | Independent capture source | `serialize.ts` (Export), already in `@devlens/panel` |
| Package boundary justified | Yes                        | Not yet                                              |

Structure, starting flat rather than preemptively nested:

```text
packages/panel/src/
    serialize.ts
    import.ts
    import.test.ts
```

growing into a subdirectory only if validation complexity actually
earns it:

```text
packages/panel/src/import/
    import.ts
    validate-import.ts
    import.test.ts
    validate-import.test.ts
```

**Constraint carried forward:** living inside `@devlens/panel` does
not mean Import logic may depend on DOM, the Renderer, or Panel UI
state. The import/validation logic stays DOM-free and independently
testable — `Panel → Import (session operation) → EventStore`, not
`Import → DOM/Renderer/Panel state`. Structurally the same discipline
Export's `serialize.ts` already follows.

A dedicated `@devlens/import` package is **deferred, not rejected** —
revisit if Import later develops an independently useful public API,
non-Panel consumers, substantial format/version handling, or enough
complexity on its own terms to justify the package overhead.

## `version` posture decision (settled 2026-08-14)

**Posture 2 accepted.** `version === 1` is a compatibility contract
starting now, not merely inert metadata being carried forward.

This is deliberately not a defense against anything that can happen
today — nothing in the codebase currently produces anything but
`version: 1`, so the check guards against exactly nothing right now.
The reason to adopt it now rather than later: Import is the first
place `version` becomes semantically load-bearing at all. Leaving it
inert while introducing the first consumer that _could_ care about it
creates an ambiguous contract that a future schema change could
violate silently — accepted by an importer that never checked,
producing malformed/mismatched semantics that "look fine" at the type
level and fail at runtime, possibly much later.

**What the field means, redefined precisely for this purpose:**
`version` is a **per-event schema compatibility discriminator** — "which
serialized `DevLensEvent` schema this object conforms to" — not an
event lifecycle version ("how many times this event has changed") and
not a DevLens release marker ("which DevLens version created this").
That gives it one precise job without making it responsible for
release management it was never meant to carry.

```text
v1 exporter → version: 1 → v1 importer accepts
v2 exporter → version: 2 → v1 importer rejects   (once v2 exists)
```

rather than the alternative this decision avoids — a v2 event silently
accepted by a v1 importer that never checked.

**Checked per-event, not per-file.** The serialized shape is
`DevLensEvent[]`; `version` lives on each event, not at a document
level (per Finding 6 — Export writes no document-level metadata). The
validator must not assume every event in an imported array shares one
version. A mixed array —

```text
[{ version: 1, ... }, { version: 2, ... }]
```

— means the second event is incompatible on its own terms; the first
is not affected by the second's failure. What happens to the rest of
the import when one event fails is Failure Semantics (below), decided
separately.

```text
validateImportedEvent(event)
        ↓
  event.version === 1 ?
        ├── yes → continue
        └── no  → reject (this event)
```

**Explicitly out of scope for this milestone** — none of the following
has earned its existence yet: migration infrastructure, a schema
registry, version negotiation, backward-compatibility matrices,
`v1 → v2` migration functions, or file-level version metadata. The
entire posture is the one check above, nothing more.

## Failure semantics decision (settled 2026-08-14)

**Whole-import rejection accepted**, on atomicity grounds — not
simplicity. The invariant:

> Import is atomic at the session level. If any event fails
> validation, no imported events are added to the EventStore.

```text
parse
  ↓
validate EVERY event
  ↓
freeze EVERY event
  ↓
only then mutate Store — no partial store.add() calls before
validation completes
```

**Validation granularity and failure granularity are separate
questions, and #3 does not imply per-event failure.** `version` is
still checked per event — the validator examines each event on its
own terms and can identify, e.g., that event index 2 in an array is
`version: 2` while the rest are `version: 1`. What the _import
operation_ does with that finding is a separate decision: it treats
one invalid event as sufficient grounds to reject the whole session,
not just that event.

**Why atomicity wins here, specifically:** Import restores a
_historical_ session, and a partially restored one is actively
misleading, not just incomplete. A 4,000-event import with 12
malformed events, under per-event rejection, produces a Panel showing
3,988 events with no data-level indication that anything was dropped
— nothing downstream (Store, Panel, Renderer) currently has any
concept of "this session was partially restored." The distinction
would have to be communicated entirely through UI, which doesn't exist
yet. Whole-import rejection avoids the ambiguous intermediate state
entirely: either the Store gains exactly the session that was
exported, or it gains nothing.

**Validator shape, now resolved by this decision:**

```ts
validateImportedEvents(input): DevLensEvent[]
```

Returns the validated events on success; failure prevents the import
from proceeding at all (exact throw-vs-result-type mechanics not
settled here, but the shape is "all or nothing," not
"accepted/rejected buckets"). This resolves the qualification carried
forward from the Architectural decision above — no need for a richer
per-event partial-success result type, since failure semantics don't
require one.

**Error reporting stays a separate, still-open concern.** _Why_
validation failed (unsupported version, invalid severity, missing
message, malformed structure, etc.) should still be preserved and
surfaced as an Import-level failure — but this is about explaining a
rejected import, not about enabling partial success. Exact shape
(e.g. an `ImportResult` with event index + reason) is not decided
here.

## Unknown/extra fields decision (settled 2026-08-14)

**Strict rejection accepted.** An imported event must contain only
fields defined by the supported `DevLensEvent` version. Unknown or
extra fields cause validation failure for that event — which, per #4,
fails the whole import.

**The core argument: `version` and event shape are one compatibility
contract, not two.** `version: 1` is meant to mean "conforms to the
known v1 shape." If a future DevLens version adds a field and a v1
importer silently accepted an event carrying it, the `version` check
would be nominal only — the actual schema boundary would be enforced
nowhere. Strict rejection keeps the contract established in the
`version` decision meaningful rather than decorative:

```text
v2 export → version: 2 → v1 importer → reject          (clean, expected)
version: 1, + newField → v1 importer → "ignore it"      (rejected as an option — undermines the version contract)
```

**Why not silently strip:** produces silent data loss. An event
carrying a future field that turns out to be meaningful gets that
field discarded, and the resulting imported session looks
successfully complete while actually containing less information than
the source — a worse failure mode than an explicit rejection, because
it isn't visible as a failure at all.

**Why not preserve as-is:** undermines the meaning of validation
itself. If `validateImportedEvent()`'s job is to establish "this is a
valid `DevLensEvent`," letting arbitrary extra properties ride along
into the Store effectively defines a second, undocumented event shape
that coexists with the documented one — and complicates any future
assumption about what's actually in a stored/frozen event.

**Not the same question as `category`'s existing openness.**
`EventCategory`'s hybrid type (`BuiltinEventCategory | (string & {})`)
is a deliberate, narrow extension mechanism for one specific field —
the category namespace is extensible by plugins. That does not imply
arbitrary top-level properties may be attached to an event generally.
These are different extension mechanisms and shouldn't be conflated;
if DevLens ever needs event-level extension fields, that should be a
deliberate, explicit addition (an extension namespace, or a future
schema version) — not something Import backs into because JSON makes
extra keys easy to carry along silently.

**Consequence carried into implementation:** the validator must
correctly distinguish an _unknown property_ (reject) from an
_allowed extensible value_ on a known field, such as an arbitrary
string `category` (accept) — these are structurally different
situations that need explicit test coverage when implementation
starts, not just a flat "reject anything not in a fixed key list"
check that might accidentally also flag legitimate `category` values.

## `id` collision handling decision (settled 2026-08-14)

**Reject on collision accepted.** Rule: imported event `id`s must be
unique both within the imported session and against all currently
retained Store events. Any collision fails the whole import (per #4),
leaving the Store unchanged.

**Cost correction to the framing this decision started from:** this
does not require an `O(n × m)` check. Build a `Set<id>` from the
Store's current contents once, then test each imported `id` against
it — `O(n + m)`, where `n` is current Store size and `m` is imported
event count. The earlier concern that collision-checking might be
prohibitively expensive at bulk-import scale doesn't hold with the
right data structure.

**Why not regenerate:** directly violates #1's own foundation —
"imported identity is historical identity and must not be rewritten."
Regenerating an `id` on collision keeps `timestamp` and every other
field intact but changes the one thing that identifies the event as
_that specific historical occurrence_. That's exactly the kind of
identity-mutation #1 ruled out when it disqualified routing through
`EventBus.report()`.

**Why not allow duplicates:** technically compatible with today's
Store (which has no native uniqueness concept), but establishes a bad
semantic state going forward — `id` exists to be a stable identity,
even if nothing currently enforces that. More concretely, the common
real-world case makes this decision itself: re-importing the same
exported file (e.g. after a crash) should behave predictably, not
silently double the Store's contents:

```text
Store already contains session A
        ↓
Import session A again
        ↓
collision detected → import rejected
```

This tells the caller "these events are already present" rather than
silently producing 2,000 events from what was actually one session
imported twice. If "replace the current Store with this session" is
ever a desired workflow, that's a distinct operation to design
explicitly later — not something Import backs into by default.

**Two collision checks, not one** — a real distinction surfaced during
this decision, not obvious from the original framing:

**A. Incoming vs. existing Store.** `existingIds ∩ importedIds` must
be empty.

**B. Incoming vs. incoming.** The imported array itself could contain
an internal duplicate (`[{id: "abc", ...}, {id: "abc", ...}]`) —
this must also be rejected, independent of what the Store already
contains. Otherwise an import could pass the Store-collision check
cleanly and still introduce a duplicate identity entirely on its own.
A single temporary `Set`, built incrementally while iterating the
imported array (checking-then-adding each `id`) and seeded with the
Store's existing ids, handles both cases together.

**Ordering consequence for implementation:** `id` collision checking
happens alongside the rest of validation, before any Store mutation —
consistent with #4's atomicity:

```text
parse → validate every event (shape, version, unknown fields)
      → validate ids (within batch + against Store)
      → all valid? no → reject, Store untouched
                  yes → freeze every event → add every event
```

**Validation ordering is an implementation detail, not a contract.**
The sequence shown above (and elsewhere in this document — shape,
then version, then unknown fields, then ids) describes one reasonable
reading order, not a required execution order. The only requirement
that is actually load-bearing: **all required validation must complete
successfully before any Store mutation occurs.** Implementation is
free to reorder or interleave these checks (e.g. for early-exit
performance) as long as that invariant holds and the whole-import
atomicity from #4 is preserved.

## Bulk-insertion ordering decision (settled 2026-08-14)

**Reject import into a non-empty Store, for v1.** Rule: a session
import requires an empty `EventStore`. Import does not merge
historical events with existing live events.

**The finding that forced this framing:** no sort by `timestamp`
exists anywhere in the codebase — not in `store.ts`, not in
`panel.ts`, not in `renderer.ts`. `EventStore.getAll()` returns
`RingBuffer.toArray()` verbatim, in pure insertion order. The Panel's
event list has only ever _looked_ chronological as an accidental
side effect of live capture — insertion time and occurrence time have
always been the same moment for Runtime/Console/Network, so nothing
has ever needed to enforce the equivalence explicitly. Import is the
first thing that can make an event's `timestamp` (when it originally
occurred) diverge from the moment `store.add()` is actually called for
it.

**Why not insertion-order-only:** would turn that accidental property
into a known, user-visible inconsistency — an imported event with an
earlier `timestamp` than existing live events would render _after_
them in the Panel, with nothing to correct it, silently violating a
behavior every consumer today implicitly depends on without any of
them actually enforcing it.

**Why not introduce sorting now:** sorting the Store itself would
change `RingBuffer`'s FIFO/insertion-ordered contract — a Core
change, of the exact kind this whole research effort has been
structured to avoid triggering unless genuinely necessary. Sorting in
the Panel instead would mean the Panel stops treating Store order as
canonical event order, which has downstream effects on navigation,
selection, filtering, search, and match counts — all built on the
assumption that Store order is the order. Import alone doesn't
justify destabilizing that.

**What this buys, concretely — an exact round trip:**

```text
Store A → export → DevLensEvent[] → import into empty Store → Store B
```

```text
A[i] ≡ B[i]
```

for every imported event, including its original `timestamp` and
`id`, since Export preserves `store.getAll()`'s order and Import (into
an empty Store) inserts in that same serialized order.

**What v1 Import deliberately does not support, stated explicitly so
it isn't mistaken for an oversight later:**

```text
Import  = restore a session into an empty Store
Import ≠ merge arbitrary historical events into a live session
```

The v1 workaround for wanting to inspect a past session alongside a
live one is manual: export/save the current session, clear the Store,
import the historical one. Not a merge feature — a sequencing of
existing operations.

**Deferred, not decided, for any future merging milestone:**
timestamp-sorted Store, an ordered view layered over an
insertion-ordered Store, or explicit session boundaries — none of
these has earned its existence for v1, and this decision doesn't
choose among them.

**Consequence for #6 worth stating explicitly:** under an empty-Store
precondition, the Store-side half of #6's collision check (imported
ids vs. existing Store ids) is checking against an empty set — so it
can never actually reject anything in v1's normal operation. This
should not be read as "safe to remove": the check is essentially free
against an empty set, and it remains real protection if the
empty-Store precondition is ever violated by a bug, a race, or a
future relaxation of this decision. The intra-batch half of #6
(duplicate ids within the imported array itself) remains fully
load-bearing regardless.

## Bulk insertion / notification volume decision (settled 2026-08-14)

**`EventStore.addMany()` accepted — the one deliberate Core change in
this research.** Contract: append all supplied events in order, notify
subscribers exactly once after the batch completes. `add()`'s existing
one-event/one-notification semantics are untouched; `addMany()` is a
new, narrow sibling operation, not a redefinition of `add()`.

```text
addMany(events)
    ↓
append events in supplied order
    ↓
notify subscribers exactly once
```

**Why #7 narrowed but didn't eliminate the problem.** The Store's
default capacity (`DEFAULT_STORE_SIZE`, 10,000) sets the realistic
worst-case import size — a full session export could legitimately
contain up to 10,000 events. A naive `forEach(store.add)` import would
mean up to 10,000 synchronous Store notifications, each triggering a
Panel update/render cycle, in a tight synchronous loop. The Panel's
`MAX_RENDERED_EVENTS` cap (300) limits how many DOM rows get
materialized, but it doesn't limit how many times the Store
_subscriber_ is invoked — every `add()` call still fires `notify()`
regardless of what the renderer ends up doing with it. `10,000 events
≠ 10,000 DOM nodes`, but it does mean 10,000 update cycles under the
naive approach.

**Why there's no useful intermediate state to preserve here, which is
what makes batching safe rather than merely convenient.** Per #7,
Import is one-shot session _restoration_, not a live merge — there is
no meaningful reason for the Panel to render 1 event, then 2, then 3,
climbing toward the final imported total. The user only cares about
the fully restored session. Collapsing N notifications into one
doesn't discard any observable state a consumer could reasonably want;
it just removes N-1 renders of intermediate states nobody needs to
see.

**Why this doesn't reopen the Option A boundary from #1.** `addMany()`
remains a pure storage operation, structurally identical to `add()` —
it does not validate, freeze, or otherwise become an integrity
boundary. That responsibility stays entirely upstream, in Import:

```text
Import: parse → validate all → check version → check unknown fields
      → check ids → require empty Store → freeze
      → Store.addMany(events)  → ONE notification → ONE Panel render
```

This is a materially smaller change than Option B (rejected in #1)
would have been — Option B would have made the Store itself
responsible for establishing event validity; `addMany()` only changes
_how many times the Store announces that new data has arrived_, which
is a batching concern, not a validation concern.

**Deliberately not built:** a stateful batching API
(`beginBatch()`/`endBatch()`). That shape invites its own problems —
nested batches, forgotten `endBatch()` calls, unclear behavior on
exceptions mid-batch — none of which this problem requires. A single
function with a narrow, complete contract (`addMany(events)`) is
sufficient and avoids inventing batching infrastructure the actual
need doesn't call for.

**Why this Core change is justified where others in this research were
rejected:** the research consistently favored options requiring zero
Core changes (Option A over B in #1; empty-Store restriction over
Store/Panel sorting in #7) — but `addMany()` responds to a concrete,
demonstrated primitive gap rather than a hypothetical one: _`EventStore`
currently assumes one insertion corresponds to one observable update,
and session restoration is a legitimate bulk-ingestion case where that
assumption is measurably inefficient and produces no useful
intermediate state._ That's a real, narrow justification, not
speculative infrastructure — and Import isn't necessarily the only
future consumer of a batched-insert primitive (a future replay
mechanism, test harness, or persisted-store restoration could
reasonably want the same operation), though no such consumer is being
built now.

## Decision summary — all eight decisions settled (2026-08-14)

```text
#1 Architecture       Option A — validate → freeze → store.add()/addMany()
#2 Package ownership  @devlens/panel, DOM-free, alongside serialize.ts
#3 Version posture    version === 1, per-event compatibility contract
#4 Failure semantics  whole-import rejection — atomic
#5 Unknown fields     strict rejection — v1 schema is closed
#6 ID collisions      reject — intra-batch (load-bearing) + Store (defense-in-depth under #7)
#7 Ordering           empty Store required — restoration, not merging
#8 Bulk insertion     EventStore.addMany() — one narrow, justified Core change
```

The research began by favoring options that required zero Core
changes, and ended with exactly one narrow addition, arrived at
because the Store's actual semantics demonstrated a concrete need —
not because batching was assumed necessary from the outset.

## Open decisions

None remaining. All eight decisions from this document are settled as
of the 2026-08-14 review. Next step is a full read-through of this
document as a completed whole (checking cross-decision consistency),
then a decision on whether an ADR is warranted — not yet drafted, per
this document's own scope.
