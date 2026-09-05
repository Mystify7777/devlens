# Research: XHR capture

Status: research, not a decision record. Nothing here is Accepted or
Rejected — that happens in an ADR amendment (or a note that no
amendment is needed), after this document has been read and argued
with. Same discipline as `network-capture.md`: if a claim below turns
out to be wrong, this document is what's wrong, not whatever decision
gets made afterward.

## Problem / scope

Fetch is closed at 427 workspace tests. `CapturedRequest` is proven as
the capture → normalization seam: Fetch produces one, the normalizer
consumes it, nothing downstream (classifier excluded) knows or cares
which capture mechanism produced it. XHR is next per ADR-0010's scope
— but "implement the obvious XHR equivalent of Fetch" turns out to be
the wrong framing. Fetch is one function call that returns one
Promise. XHR is a stateful object with a five-value `readyState`, up
to nine possible events, a synchronous mode that behaves nothing like
its asynchronous mode, and native `timeout`/`abort` events Fetch
doesn't have. The question this document exists to answer isn't "how
do we capture XHR" — it's "what, exactly, does XHR's lifecycle
guarantee, verified against the spec rather than assumed from Fetch's
shape."

This is research only. No production code changes. No ADR amendment.
The output is verified facts, organized into the questions that
matter for Step 4B onward — not implementation commitments.

## What DevLens is observing

Same framing as `network-capture.md`'s "What Network observes" section
— completed client-side network operations, not transport internals.
Nothing here changes that. What's genuinely new for XHR is that
"completed" has to be defined against a stateful object's event
sequence rather than a single Promise's settlement, and — as the
synchronous-mode finding below shows — "completed" doesn't always mean
what it means for Fetch.

## XHR lifecycle

### `readyState` values

`UNSENT (0)` → `OPENED (1)` → `HEADERS_RECEIVED (2)` → `LOADING (3)` →
`DONE (4)`. `open()` moves the object to `OPENED`; `send()` begins the
transition through `HEADERS_RECEIVED`/`LOADING` to `DONE`. `status`
becomes readable starting at `HEADERS_RECEIVED` — before that, it's
`0`, not because anything failed, but because no response has arrived
yet to have a status.

### Events, in the order the spec actually fires them

For a normal **asynchronous** request that succeeds: `readystatechange`
(→`OPENED`) → `loadstart` → `readystatechange` (→`HEADERS_RECEIVED`) →
`readystatechange` (→`LOADING`) → zero or more `progress` → `readystatechange`
(→`DONE`) → `load` → `loadend`. The exact WHATWG spec text for the
success path: _fire a progress event named progress, set state to
done, fire readystatechange, fire a progress event named load, fire a
progress event named loadend_ — `load` and `loadend` are the last two
events, in that order, every time, for every non-synchronous request
regardless of outcome category.

**`loadend` fires after `load`, `error`, `abort`, and `timeout`
uniformly** — confirmed directly from MDN's own description ("fired
when a request has completed, whether successfully... or
unsuccessfully"), not inferred. This is the async-mode equivalent of
Fetch's Promise settling: exactly one terminal signal, regardless of
which of the four specific outcomes occurred. That directly answers
Question 1's "how does this prevent duplicate reporting" — `loadend`
fires exactly once per request lifecycle (verified below for the
abort-after-completion edge case too), so a completion handler
attached to it, and only it, cannot double-report the way listening to
multiple individual event types (`load` _and_ `error` _and_ `abort`
_and_ `timeout`) could if implemented carelessly.

### `abort()` behavior — verified, not assumed

Per MDN's `abort()` documentation: **if the request is still in
progress** (`readyState` is not `DONE` or `UNSENT`), calling `abort()`
dispatches `readystatechange`, then `abort`, then `loadend`, in that
exact order. If the request is already `DONE`, calling `abort()`
afterward does not re-dispatch these events — there's nothing left to
abort. That directly answers the "can `abort()` after completion cause
duplicate signals" question: no, by spec, calling `abort()` on an
already-`DONE` request is a no-op with respect to events.

### `send()` before `open()`, or calling `send()` twice

`send()` throws `InvalidStateError` if the object's state isn't
`OPENED` or if a send is already in progress. This is a synchronous
throw, not an async error signal — symmetrical to Fetch's own
synchronous-throw case, and for the same reason: nothing was ever
initiated, so there's nothing to report asynchronously either.

### `open()` throwing

`open()` throws `SyntaxError` if the method isn't valid or the URL
can't be parsed, `SecurityError` if the method case-insensitively
matches `CONNECT`, `TRACE`, or `TRACK` (forbidden methods), and —
relevant to the synchronous-mode section below —
`InvalidAccessError` if `async` is `false`, the current global object
is a `Window`, and either `timeout` is non-zero or `responseType` is
non-empty.

## Completion semantics

**`loadend` is the single completion signal for async XHR — analogous
to Fetch's Promise settling, but arrived at differently.** Fetch has
exactly one terminal state by construction (a Promise can only settle
once); XHR has to be _shown_ to have exactly one terminal event, which
the `abort()`-after-`DONE` behavior above and the spec's own event
sequence both confirm. `readystatechange` reaching `DONE` is
tempting to use instead (it's the "traditional" XHR completion check
many older codebases use), but MDN explicitly warns
`readystatechange` "should not be used with synchronous requests," and
— as the next section shows — for sync requests it isn't fired at
all, which rules it out as a _general_ completion mechanism even
though it happens to work for async requests specifically. `loadend`
doesn't have that asymmetry for async requests, which is one more
reason to prefer it.

## Timing semantics

**`send()`, not `open()`, is the correct point to start timing** —
verified against what each call actually does, not assumed because
"send starts the request" sounds right. `open()` only configures the
request (method, URL, sync flag) and moves `readyState` to `OPENED`;
no network activity of any kind begins until `send()` is called, and
nothing in the spec suggests otherwise. An application can legitimately
call `open()` long before `send()` — timing from `open()` would
measure "however long the application took to decide to send,"
which is exactly the "request configuration time" category Fetch's
own model has no equivalent of and doesn't need one for. This is the
direct XHR analog of Fetch's own single call: `fetch()` combines
"configure" and "initiate" into one call DevLens times start-to-finish;
XHR splits that same operation into two calls, and `send()` is the one
that corresponds to what `fetch()` actually does.

## Synchronous XHR — the load-bearing finding of this document

This is the one place research materially changed the shape of the
problem, not just filled in detail.

**Verified directly from the WHATWG spec text: synchronous XHR does
not fire `progress`, `readystatechange`, `load`, or `loadend` at all.**
The spec's own completion steps are explicitly gated: _"If xhr's
synchronous is false, then fire a progress event... fire an event
named readystatechange... fire a progress event named load... fire a
progress event named loadend."_ Every one of those four events is
conditioned on `synchronous` being `false`. For a synchronous request,
none of them fire — not "fire late," not "fire in a different order,"
they are not dispatched at all. This isn't inferred from confusing
cross-browser behavior (though there's plenty of that too — Firefox
historically didn't fire `readystatechange` for sync requests at all
while Chrome/Safari/IE did, a genuine historical cross-browser
inconsistency bug, separate from and layered on top of the spec's own
"none of the four fire" rule) — it's the specification's own explicit
behavior for the case this project would actually be shipping against.

This means **`loadend`, this document's own answer to "what constitutes
completion," structurally cannot be used to detect synchronous XHR
completion at all.** It isn't a matter of the signal being less
reliable for sync requests — the signal doesn't exist for them. Any
implementation that listens for `loadend` and assumes it covers "every
XHR request" will silently never fire for synchronous ones.

Three more, independently-confirmed facts make synchronous XHR a
structurally different case rather than a harder version of the same
case:

- **`timeout` cannot be set on a synchronous request in a `Window`
  context** — both the spec and MDN confirm this throws
  `InvalidAccessError`. There is no such thing as "the timeout for a
  sync XHR" to even reason about.
- **`abort()` on a synchronous request doesn't dispatch events —
  it throws an error instead** (MDN, `abort()` documentation,
  confirmed above). The graceful abort path this document relies on
  for async requests has no synchronous equivalent.
- **Synchronous XHR outside of Web Workers is, per the spec's own
  text, "in the process of being removed from the web platform"** —
  not a stylistic recommendation against it, an explicit,
  spec-acknowledged platform-level deprecation, already partially
  enforced (Chrome disallows sync XHR during page-dismissal events as
  of Chrome 89, cited above).

None of this rules out DevLens ever supporting synchronous XHR. It
does mean supporting it would require an entirely different detection
mechanism than the one this document is recommending for everything
else — timing and reading `xhr.status` immediately after the blocking
`send()` call returns, rather than any event listener, since no event
DevLens could listen for would ever fire. That's a second, mostly
disconnected implementation path, not an edge case of the first one.

## `open()` without `send()`

Verified structurally, not just by expectation: `open()` performs no
network activity — it only sets `readyState` to `OPENED` and records
the method/URL/sync-flag internally. Nothing in the spec describes any
further event or state transition happening without a corresponding
`send()` call. **No event should be reported**, and this isn't a
policy choice DevLens is making — there is no completion for a request
that was never sent, symmetric to Fetch's own synchronous-throw case
(nothing was initiated, so nothing settles, so nothing is reported).

## Abort / timeout / error — classification evidence

This is where XHR gives DevLens _better_ evidence than Fetch did, not
just different evidence.

- **`ontimeout`/ the `timeout` event fires specifically and only when
  `XMLHttpRequest.timeout` elapses before the request completes** —
  a dedicated, unambiguous signal. Contrast with Fetch, where (per
  `network-capture.md`'s own finding) a caller-implemented timeout via
  `setTimeout(() => controller.abort())` is indistinguishable from a
  real user cancellation unless the caller specifically used
  `AbortSignal.timeout()`. XHR has no such ambiguity: if `ontimeout`
  fired, the browser's own timer — not application code guessing —
  is what ended the request.
- **`onabort`/the `abort` event fires specifically and only when
  `abort()` was called** — equally unambiguous, and for the same
  reason: it's a dedicated event, not an inferred classification from
  an error's `.name`.
- **`onerror`/the `error` event fires for network-level failures** —
  DNS failure, connection refused, CORS rejection (see "Redirects and
  cross-origin behavior," below) — and, per the spec's own "handle
  errors" algorithm quoted above, `error`/`abort`/`timeout` are
  already mutually exclusive by construction ("if xhr's timed out is
  true... otherwise if response's aborted flag is set... otherwise if
  response is a network error") — the browser itself has already done
  the classification DevLens's Fetch classifier had to reconstruct
  from an ambiguous `error.name`.

**Practical consequence for the classifier contract**: XHR doesn't
need DevLens to guess at all for these three cases — `ontimeout`
firing IS the evidence for `timeout`, `onabort` firing IS the evidence
for `aborted`, and `onerror` firing (when neither of the other two
applies) IS the evidence for `network-error`. Whether that means XHR's
capture layer produces a `FetchSettlement`-shaped input to the
_existing_ `classifyFetchOutcome()` (renamed, or reused as-is if it's
already source-agnostic enough) or needs its own
`classifyXhrOutcome()` is a Step 4B/4D implementation question, not a
research one — but the research answer to "does the existing
`NetworkOutcome` contract need new values for XHR" is **no**: every
XHR-native signal maps onto an outcome value that already exists
(`aborted`, `timeout`, `network-error`, `http-error`, `success`).

## Redirects and cross-origin behavior

**XHR follows redirects automatically and transparently, with no
manual-mode equivalent to Fetch's `redirect: "manual"`.** There is no
API surface to observe intermediate hops; `xhr.responseURL` exposes
only the final URL after any redirects completed. This makes XHR's
redirect story _simpler_ than Fetch's, not harder — the "should v1
opt into surfacing intermediate hops" open question `network-capture.md`
left open for Fetch doesn't even have an XHR equivalent to resolve,
since XHR never offers a mechanism to opt into that visibility at all.

**XHR has no equivalent of Fetch's `mode: "no-cors"`, and therefore no
opaque-response concept.** A cross-origin request blocked by CORS (no
appropriate `Access-Control-Allow-Origin` response header) doesn't
produce a readable-but-limited response the way an opaque Fetch
response does — it fails outright: the `error` event fires, `status`
reads `0`, and no response body or headers are available at all. This
is genuinely different from Fetch's opaque case, not a variant of it:
Fetch's opaque response is a _successful settlement_ with deliberately
withheld detail; XHR's CORS failure is an _error settlement_ with no
detail because nothing was received. Concretely, this means the
`opaque` outcome value (added to `NetworkOutcome` during the Fetch
classification-contract discussion) has no XHR-side producer — XHR's
CORS-blocked case already falls naturally into `network-error` via the
`onerror` path, with no new branch required.

## Response / status behavior

`status` and `statusText` become meaningful starting at
`HEADERS_RECEIVED` (`readyState` 2) and are stable by `DONE`. Reading
`status` before `HEADERS_RECEIVED` returns `0` — not a signal of
failure, just "no response yet," the same non-evidence `network-capture.md`
already warned against over-interpreting for Fetch's own `status
=== 0` case. Whatever XHR's capture layer does, it should read
`status` only after `loadend` (or, for the timeout/abort/error paths,
from within those specific handlers), never speculatively earlier.

**Method and URL are not exposed as public properties on an XHR
instance** — unlike a Fetch `Request`, which carries `.method`/`.url`
directly, XHR has no equivalent readable properties. Whatever DevLens
captures has to be recorded at `open()` time (from `open()`'s own
arguments) and correlated forward to whichever event handler
eventually fires completion — almost certainly via a `WeakMap` keyed
by the XHR instance itself, since the object has no natural place to
attach DevLens-owned metadata without risking collision with
application code that might inspect or iterate the instance's own
properties. This is a concrete architectural consequence of XHR's
two-call (`open()` + `send()`) shape that Fetch's single-call shape
never had to deal with — captured here as a finding, not decided as an
implementation yet.

## Browser limitations / cross-browser notes

- Firefox's historical divergence on firing `readystatechange` for
  synchronous requests (Bugzilla #313646, cited above) is a real,
  documented cross-browser inconsistency — but it's layered on top of,
  not a contradiction of, the spec's own "none of the four events fire
  for sync requests" rule this document is built around. Since this
  document already rules out `readystatechange` as XHR's completion
  signal for other reasons, that particular inconsistency doesn't end
  up mattering to the recommendation below.
- Chrome disallows synchronous XHR specifically during page-dismissal
  events (`unload`/`beforeunload`/`pagehide`) as of Chrome 89 — one
  more concrete, current-generation signal (alongside the spec's own
  deprecation language) that synchronous XHR is actively shrinking as
  a supported surface, not a stable corner of the platform DevLens
  needs to treat as equally load-bearing as async XHR.

## Candidate implementation models (not decisions)

**A. Patch `open()` and `send()` on `XMLHttpRequest.prototype`;
`open()` records `{ method, url }` per-instance (`WeakMap`); `send()`
starts timing, attaches a single `loadend` listener that reads
`status`/classifies/reports, and is the only place a `CapturedRequest`
is ever built.** This is the async-XHR analog of Candidate A from
`network-capture.md` — one event, on completion, reusing the same
`CapturedRequest`/`normalizeNetworkEvent()` seam Fetch already proved.
Synchronous XHR is explicitly out of scope for this candidate — not
silently dropped, but named as a boundary, per the finding above that
it structurally cannot use the same detection mechanism.

**B. Same as A, plus a second, separate code path for synchronous
XHR** that times around the blocking `send()` call itself and reads
`status` immediately after it returns, with no event listener
involved (because none would fire). This is a real, buildable
extension of A, not a rejected alternative — but it's additional scope
this document isn't recommending Step 4B take on immediately, given
the spec's own deprecation trajectory and the complete absence of
`timeout`/graceful-`abort` support for sync requests undercutting most
of the value DevLens would be adding by supporting it.

**C. Treat `readystatechange` reaching `DONE` as the completion
signal instead of `loadend`.** Rejected by this document's own
findings, not carried forward as a live option: it doesn't fire for
sync requests either (same spec gating as `loadend`), so it buys
nothing over `loadend` for the sync case while adding the documented
cross-browser inconsistency history and MDN's own explicit warning
against relying on it.

## Architectural evaluation

Mirroring `network-capture.md`'s own table, evaluated against what
Fetch already proved rather than against general principles restated
from scratch:

| Principle                                                                 | Candidate A (async only)                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Reuses `CapturedRequest` → `normalizeNetworkEvent()` without modification | Yes                                                                                                                  |
| Reuses the existing `NetworkOutcome` enum without new values              | Yes — verified above, XHR's evidence maps onto values that already exist                                             |
| One occurrence → one event                                                | Yes — `loadend` fires exactly once per async request lifecycle, verified via the abort-after-`DONE` no-op behavior   |
| Panel needs no new concept                                                | Yes, for the same reason Fetch didn't need one — `origin: "xhr"` is the only marker, exactly as ADR-0010 anticipated |
| Complexity stays inside `@devlens/network`                                | Yes                                                                                                                  |
| Covers 100% of what `XMLHttpRequest` can do                               | **No** — synchronous requests are explicitly out of scope for this candidate                                         |

That last row is the honest state of this research: Candidate A is a
strong, low-risk design for the overwhelming majority of real-world
XHR usage (asynchronous, which is also the only mode the platform
itself is still investing in), and an explicit, documented, spec-backed
non-goal for the minority (synchronous) — not a silent gap discovered
later.

## Open questions (genuinely unresolved, not decided by this document)

- Whether Step 4B builds a dedicated `classifyXhrOutcome()` or extends
  `classifyFetchOutcome()`'s existing shape to accept XHR-sourced
  evidence — this document only established that no new `NetworkOutcome`
  values are needed, not which function should own the mapping.
- Whether synchronous XHR (Candidate B) is ever built at all, given
  the platform's own deprecation trajectory — leaning toward "not for
  v1," not decided here.
- The exact shape of the per-instance `WeakMap` correlating `open()`'s
  captured method/URL forward to `send()`'s completion handler — a
  real implementation detail, not a research question.
- Whether `open()` being called a second time on an already-`send()`-ing
  instance (re-opening a request mid-flight — allowed by the spec)
  needs special handling, or whether it naturally falls out of the
  `WeakMap` simply being overwritten. Leaning toward "falls out
  naturally," not verified against a real test yet.

## Conclusion / recommendation

`loadend` is the correct, spec-verified completion signal for
asynchronous XHR — the direct analog of Fetch's Promise settling, with
its "exactly once" guarantee confirmed via the `abort()`-after-`DONE`
no-op behavior rather than assumed. `send()`, not `open()`, is the
correct timing start, for the same reason `fetch()`'s single call was
timed start-to-finish rather than split. XHR's native `timeout`/`abort`
events give DevLens strictly better classification evidence than
Fetch's ambiguous `AbortError` did, and — verified, not assumed — the
existing `NetworkOutcome` contract already covers everything XHR can
produce, including its CORS-failure case, with no new values required.

The one finding worth carrying forward as a named, permanent boundary
rather than an implementation afterthought: **synchronous XHR cannot
be detected via any event DevLens could listen for, because the spec
itself never fires those events for synchronous requests.** That's not
a reason to rule it out forever — Candidate B above is a real,
buildable path if a future need justifies it — but Step 4B should
build Candidate A (async only) and treat synchronous XHR as an
explicit, documented non-goal, the same way `network-capture.md`
treated WebSocket and Server-Sent Events: named, not silently dropped.

No ADR amendment is warranted by anything in this document. ADR-0010
already covers XHR as an accepted interception mechanism, and nothing
here contradicts or requires reopening any of that ADR's decisions —
the existing `CapturedRequest`/`NetworkOutcome`/classifier-normalizer
separation absorbs everything XHR's lifecycle actually requires.
