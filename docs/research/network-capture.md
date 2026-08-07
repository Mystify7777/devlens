# Research: Network capture

Status: research, not a decision record. Nothing here is Accepted or
Rejected — that happens in an ADR, after this document has been read
and argued with. If a claim below turns out to be wrong once someone
actually prototypes against real browsers, this document is what's
wrong, not the ADR that hasn't been written yet.

## Problem

Every capture source DevLens has shipped so far — Runtime, Console —
observes something that happens once: an error is thrown, a console
method is called. Occurrence, normalize, `bus.report()`, done. A
network request is not that shape. It starts, time passes, and only
later does it succeed, fail, or get abandoned. Before writing an ADR
that just answers "how do we capture `fetch`," we need to answer a
prior question: does DevLens's event model — one real-world occurrence
produces exactly one immutable `DevLensEvent` — actually hold for
something with a *duration*, or does Network expose an assumption that
was accidentally baked into Runtime and Console without anyone
deciding it on purpose?

## What Network observes (and doesn't)

Runtime observes the window. Console observes the console. Network
observes something categorically different: not packets, sockets, TCP
connections, DNS, or anything below the application's own API
boundary — it observes **completed client-side network operations**,
the same unit of information already visible to a developer reading
their own `fetch()`/`XHR` call sites. That one sentence narrows scope
more than it looks: it rules out low-level transport diagnostics
(retransmits, connection reuse, TLS handshake detail) as something
Network needs to explain, the same way Runtime doesn't explain garbage
collection and Console doesn't explain the V8 event loop. Network's
job is "what request did the app make, and what happened to it" — not
"what did the network do."

## Is Network still a Plugin?

Worth asking directly, since terminology tends to ossify once it's
written into an ADR title. Runtime observes `window`; Console observes
`console`; Network would observe `fetch`/`XHR` — and unlike the first
two, *observing* Network requires actively wrapping those globals,
not just listening to them. That's a real difference in mechanism. Is
it a real difference in *kind* — should Network be some other category
of thing entirely, not a Plugin?

Looking at what ADR-0006 actually specifies, the Plugin contract is
`{ install(): void; uninstall(): void }`, both idempotent — and
nothing in that contract says anything about *how* a plugin captures
data. It was never mechanism-specific to begin with: Runtime's
`install()` attaches listeners, Console's `install()` wraps five
console methods (already a form of interception, just a friendlier
one than `fetch`). Network's `install()` would patch `fetch` and
`XHR.prototype` and its `uninstall()` would restore the originals —
more invasive than Runtime, more invasive even than Console, but
answering the exact same question every other plugin's `install()`
answers: *start observing, cleanly, reversibly.* The mechanism scales
in aggressiveness across Runtime → Console → Network; the contract
those three mechanisms sit behind does not change at all.

So: still a Plugin, and this isn't a hedge — the reasoning above is
fairly conclusive, not a live fork the way the semantic-unit-of-
observation question was. What's worth carrying into the ADR is the
distinction itself: "capture mechanism" and "Plugin contract" are two
different layers, and it's expected (not a design smell) for different
plugins to differ wildly in the former while sharing the latter
exactly. Naming that explicitly now means the next capture source
after Network — whatever it ends up being — doesn't have to re-litigate
whether *its* mechanism is "too invasive to still be a Plugin" either.

## Stress-testing the one-event model against real scenarios

The Architectural evaluation section argues Candidate A on principle.
Worth also checking it against a few concrete cases, since a model that
only survives contact with tables of principles isn't actually proven
yet.

**Scenario 1: `fetch()` never resolves, and stays that way (a hung
connection, not a page unload) — no event, ever.** Under Candidate A,
an occurrence that never completes never gets reported, by
construction. That's consistent with the model's own logic, but it's
worth being more precise than the earlier "no in-flight visibility"
trade-off already flagged in Architectural evaluation: this isn't
"the Panel shows it later than DevTools would" — it's "the Panel never
shows any trace of it at all, for as long as the Panel keeps running."
A request that hangs forever is arguably exactly the kind of thing a
diagnostics tool should surface, and Candidate A structurally cannot.
Chrome DevTools doesn't have this gap, but not because it made a
different design choice at this same layer — it observes at the
browser/network-stack level, a genuinely different vantage point than
any in-page JS interceptor (Candidate A, B, or C alike) can occupy.
That's worth being honest about: this specific gap isn't something
Candidate B closes for free either. B's "start" event would still only
be a static, already-reported, immutable record the Panel would have
to specially interpret as "maybe still open" — which is exactly the
"Panel needs to learn a new concept" cost the evaluation table already
charges against B. So this scenario sharpens an already-acknowledged
trade-off rather than surfacing a new one, but it sharpens it enough
that it's worth stating this precisely, not just gesturing at "no
in-flight visibility" as if it were a minor cosmetic gap.

**Scenario 2: `fetch()` succeeds, then `response.json()` throws on a
malformed body — does Network report `success` or `error`?**
`success` — and this falls directly out of a decision already made
elsewhere in this document, not a new judgment call. Network doesn't
read response bodies by default (the privacy-defaults discussion,
above), which means it structurally has no way to know whether
`response.json()` would succeed or throw — it only ever sees that a
response was received. The parsing failure, if the application doesn't
catch it, becomes an uncaught exception Runtime's existing
`unhandledrejection`/`error` listeners already capture on their own,
with no coordination required between the two plugins. If the
application *does* catch it silently, neither plugin reports anything
— consistent with the "What Network observes" framing above: DevLens
surfaces what's visible at the API boundary a developer already
reads, not things the developer's own code chose to swallow. Worth
stating explicitly in the eventual ADR: Network's success/error
boundary sits at the HTTP layer specifically *because* it doesn't
inspect bodies, not as two independent decisions that happen to agree.

**Scenario 3: HTTP 500 with a valid JSON body — outcome
`http-error`, severity open.** Already resolved by the existing
"Outcome and severity are different axes" section; included here only
to confirm the model produces an unambiguous answer for the case that
motivated that section in the first place.

## Current architecture (what Network has to fit into, or deliberately not fit into)

- **ADR-0001/0002**: `DevLensEvent` is `deepFreeze`d the moment
  `bus.report()` returns it. There is no update-in-place story anywhere
  in Core.
- **ADR-0004**: the Event Store is append-only — `add()` is the only
  way an event enters it; there's no `update()`.
- **ADR-0005** (Runtime): "never overwrite a global the host app might
  be using" — `addEventListener`, not `window.onerror = fn`.
- **ADR-0007** (Console): original behavior always runs first,
  unconditionally, before any DevLens-internal work; a narrow
  `try/catch` around `bus.report()` only, not around normalization.

Network is the first source that has to actively decide whether each
of these still applies, rather than inheriting them for free.

## Questions

1. **What is the semantic unit of observation?** One event on
   completion, two correlated events (start + end), or a mutable event
   updated in place?
2. **What is the *identity* of a request** — not just what data it
   carries, but what makes two requests "the same operation" or
   different ones? `GET /users/123` and `GET /users/456` are
   technically different URLs; are they the same *endpoint*, viewed
   300 times, or 300 different things? `/products?page=1` and
   `/products?page=2` raise the same question from the query-string
   side. This is a distinct question from redaction (which asks "is
   this safe to show") — identity asks "should these collapse into
   one conceptual thing at all," and nothing in this document answers
   it. Flagged as first-class rather than folded into the redaction
   discussion below, since a wrong answer here isn't a privacy
   problem, it's a usability one: get it wrong and the Panel becomes a
   wall of nominally-unique URLs that are really the same three
   endpoints called with different arguments.
3. **What does a Network event actually need to carry**, and — this
   turned out to be a much bigger question than it looks — what should
   it explicitly *not* carry by default?
4. **How is "failure" classified?** An HTTP 500 that returns valid
   JSON, a timeout, a DNS failure, and `AbortController.abort()` are
   observably different things at the browser API level, but many
   tools collapse several of them into the same signal.
5. **What's the interception mechanism**, given neither `fetch` nor
   `XMLHttpRequest` has an `addEventListener`-based hook the way
   `window.error` did?
6. **What's the v1/deferred boundary?**

## Industry survey

A caution before the survey itself: OpenTelemetry shows up more than
any other source below because it's the most thorough public answer
to "what is a network operation," not because DevLens should adopt its
conclusions by default. OTel's design serves distributed tracing —
sampling, exporters, cross-process trace propagation, span hierarchies
— none of which DevLens has or needs. Where OTel is cited below, the
right question is "is this useful because it's conceptually correct
for an in-browser diagnostics tool," not "because a mature project
already did it." Most of what's cited here reads as the former (the
cancellation-isn't-an-error distinction, for instance, has nothing to
do with distributed tracing specifically), but it's worth naming the
risk explicitly rather than letting OTel quietly become the design by
default just because it's the most detailed source available.

### OpenTelemetry (HTTP semantic conventions)

The most directly relevant prior art, since OTel's entire job for the
last several years has been answering "what is a network operation,"
across every language, for exactly the purpose DevLens needs it for.
Three findings that matter here:

- **Cancellation is explicitly not an error.** If instrumentation can
  detect that a request was cancelled intentionally (a caller-driven
  abort), the span status is left unset — `error.type` is only set for
  a real failure. This is a direct, standards-level answer to Question
  3: an aborted request and a failed request are not the same
  `outcome`, and treating them the same is something OTel specifically
  warns against.
- **Query parameter redaction is a first-class, documented default**,
  not an afterthought. .NET's `HttpClient` instrumentation redacts
  query parameter *values* by default (`?sig=*`) while preserving the
  parameter *names*, with an explicit override list of additional
  keys to always redact. This is a more useful default than either
  extreme — stripping the whole query string throws away real
  diagnostic value (which parameters were even sent), while keeping
  values by default is the wrong default for anything that might
  contain a token or PII.
- **When an error occurs before a response is received, `error.type`
  is a low-cardinality identifier** (exception type, not the raw
  exception message); when a response *is* received, `error.type` is
  the status code itself. Two different failure shapes, deliberately
  represented differently rather than flattened into one "error"
  boolean.

### Resource Timing API (the browser's own model)

`PerformanceResourceTiming` is the standard the browser itself uses to
time every resource fetch, including `fetch()` and `XHR`. Two things
worth knowing before inventing DevLens's own duration measurement:

- `PerformanceEntry.duration` is defined as `responseEnd - startTime`
  — this *includes* redirects and any connection-queueing/blocking
  time, not just "time the response body was in flight." A
  `responseEnd - fetchStart` measurement is the "time to fetch,
  excluding redirects" variant. These are genuinely different numbers,
  and picking one without saying so invites exactly the kind of
  "why does the panel show a different duration than DevTools"
  confusion this research is trying to avoid.
- **Cross-origin entries are mostly zeroed out by default.** Unless
  the resource explicitly opts in via a `Timing-Allow-Origin` response
  header, `requestStart`, `responseStart`, `domainLookupStart`, etc.
  all read as `0` for cross-origin requests — `responseEnd` is the one
  property exempted from this restriction. Combined with the default
  250-entry buffer, correlating `PerformanceObserver` entries back to
  a specific `fetch()`/`XHR` call by URL is unreliable for anything
  DevLens can't guarantee is same-origin. This is a strong argument
  for DevLens timing its own intercepted calls directly (capturing a
  timestamp immediately before calling the original `fetch`/`send`,
  and again when the promise/event fires) rather than trying to read
  the Resource Timing buffer after the fact.

### Sentry (JavaScript SDK)

- **Bodies and headers are opt-in, not default**, and the SDK's own
  pull-request discussion for adding optional request/response payload
  capture explicitly flags it may contain PII and asks whether the
  existing PII-scrubbing pass should apply to it too. Confirms this
  isn't a hypothetical concern — the team building the instrumentation
  tool raised it themselves before shipping the feature.
- **Capturing a response body changes the interception's cost
  profile**, not just its privacy profile: the same discussion notes
  the fetch handler has to become `async` (awaiting `response.text()`)
  specifically to support optional body capture, and that this
  shouldn't change timing when the option is off. Worth remembering if
  DevLens ever considers response bodies later — it's not a free
  addition to the interceptor.
- **URL normalization is a documented, common need**, but Sentry
  implements it as an opt-in hook (`beforeStartSpan`) the *host
  application* configures with its own route knowledge (e.g.
  `/users/12312012` → `/users/:userid`), not something the SDK infers
  automatically. Nobody tries to guess route parameters generically.
- **Status `0` is a recurring source of confusion in their own issue
  tracker** — aborted requests, requests still in flight when the page
  unloads, and (in one specific bug) XHR responses arriving after
  their originating span was already torn down all surface as
  ambiguous zero-status events, and users repeatedly ask what actually
  happened. This is real-world evidence, not a hypothetical edge case,
  that collapsing "aborted," "network failure," and "unknown" into a
  single ambiguous status value costs real debugging time downstream.

### Datadog RUM

- Their own SDK issue tracker has an open request specifically because
  `status_code: 0` errors are indistinguishable between "request
  aborted (timeout)," "server/internet down," "blocked by a browser
  extension," and "blocked by CORS" — the reporter explicitly says
  they don't know which one occurred and asks for duration to be
  included as a disambiguating hint. Second independent confirmation
  (after Sentry) that this specific ambiguity is a recurring, real
  complaint, not a theoretical concern this research is inventing.
- Datadog RUM automatically uses the Resource Timing API for detailed
  network timing when available, with an explicit opt-in
  (`trackResourceHeaders`) to also collect header metadata — headers
  are not on by default here either.

### Chrome DevTools Network panel

- The Status column distinguishes an actual HTTP status code from a
  distinct `(canceled)` state (surfaced from the underlying
  `net::ERR_ABORTED`) and a separate `(failed)` state for network-level
  errors — three visually and semantically different outcomes, not one
  "it didn't work" bucket. This matches the OTel finding above:
  mature tools consistently keep "cancelled," "failed," and "succeeded
  with an error status" as distinct outcomes rather than flattening
  them.

### Mock Service Worker / `@mswjs/interceptors`

Not studied for interception technique (MSW's mocking use case is
different from DevLens's observing use case) but for what it reveals
about the *reliability* of alternatives to direct monkey-patching:

- MSW's browser strategy is Service-Worker-based interception,
  specifically framed as avoiding "patching `fetch` and meddling with
  the application's integrity."
- However, MSW's own documented limitations page states that
  **Firefox does not notify the Service Worker when a page makes an
  XMLHttpRequest at all** — even with a matching handler registered,
  Firefox-originated XHRs are invisible to a Service-Worker-based
  interceptor. Their own Node.js interception library
  (`@mswjs/interceptors`) does *not* use a Service Worker — it extends
  `http`/`https`/`XMLHttpRequest`/`fetch` directly, the same
  monkey-patching approach MSW frames as something to avoid in the
  browser.
- This is a concrete, documented case where the "more principled"
  interception mechanism (Service Worker) is measurably *less*
  reliable cross-browser than direct patching, for exactly the API
  (XHR) DevLens would also need to intercept. Worth weighing against
  any instinct to reach for a Service Worker as a "cleaner" alternative
  to patching globals.

## The fetch/XHR timeout-vs-abort asymmetry (a finding, not just a question)

This deserves its own section because it's a concrete browser-API fact
that directly constrains Question 3, not just a design opinion.

- **XHR has native, distinct events for `timeout` and `abort`** — a
  request that hits `xhr.timeout` fires `ontimeout`; a request stopped
  via `xhr.abort()` fires `onabort`. These are genuinely different,
  browser-dispatched signals.
- **`fetch()` has no native concept of a request timeout at all.**
  Every timeout implementation is caller-side, via `AbortController`.
  Until recently this meant a `fetch()` promise rejects with the exact
  same `AbortError` regardless of *why* it was aborted — a real user
  cancellation and a caller-implemented timeout were indistinguishable
  from the interceptor's point of view.
- **`AbortSignal.timeout()`** (a relatively recent, standardized
  addition) changes this *if the calling code uses it*: a timeout
  triggered this way rejects with a distinct `TimeoutError`, separate
  from the `AbortError` a manual `controller.abort()` produces. But
  this only helps DevLens distinguish the two cases when the
  intercepted application code actually uses `AbortSignal.timeout()`
  rather than the older, still extremely common
  `setTimeout(() => controller.abort(), ms)` pattern — which still
  produces a plain `AbortError`, indistinguishable from a real user
  cancellation.
- **Net effect: XHR's timeout/abort distinction is reliable; fetch's
  is only sometimes available**, and DevLens can't control which
  pattern a given application uses. Any "outcome" classification that
  claims to distinguish timeout from cancellation needs to say
  explicitly that this distinction is best-effort for fetch, not
  guaranteed.

## Outcome and severity are different axes, not one concept

Worth separating explicitly, because the research above (and the
Candidate A sketch) could easily be read as implying `outcome` doubles
as `severity`. It shouldn't:

- **`outcome` describes what actually happened** —
  `success`/`http-error`/`network-error`/`aborted`/`timeout` (or
  whatever the eventual enum is) is a factual classification of the
  request's fate, independent of how anyone feels about it.
- **`severity` describes how DevLens presents it** — DevLens's existing
  closed union (`trace`/`debug`/`info`/`warn`/`error`/`fatal`, per
  Core's `EventSeverity`) is an interpretation layered on top.

These don't map one-to-one. A `404` is an `outcome` of `http-error`,
but whether that's `warn` or `error` is a judgment call — a 404 on an
optional prefetch and a 404 on the main data fetch a page depends on
are the same `outcome` with arguably different `severity`. An
`aborted` outcome (a component unmounted mid-request, a search box's
previous query was intentionally cancelled) is often not an error at
all in the developer's eyes — closer to `info`, or arguably no
severity worth surfacing prominently. Coupling the two would mean
"what happened" and "how alarming is it" can never be reasoned about
independently, which they clearly need to be. Which exact severity
each outcome maps to is not decided here — this section only argues
that the two concepts should stay decoupled in the schema, whatever
the mapping ends up being.

## Redirects

A three-hop redirect chain (`301` → `302` → `200`) raises a question
none of the candidate designs above answer on their own: is that one
request, or three? The browser itself gives an ambiguous answer
depending on which API is asked — `fetch()` with its default
`redirect: "follow"` mode resolves the whole chain silently and only
ever exposes the *final* response to calling code (the intermediate
`301`/`302` responses are invisible unless `redirect: "manual"` is
used, which changes browser behavior — the request stops following
redirects at all and hands back an opaque response for the caller to
resolve itself). XHR follows the same "silently resolve, expose only
the end" behavior with no manual-mode equivalent at all.

That asymmetry matters for Candidate A specifically: if DevLens
observes only what `fetch`/`XHR` naturally expose, a redirect chain is
*already* one request as far as the interceptor can see — there's no
extra design decision required to get "one event per redirect chain,"
because the browser doesn't hand DevLens the intermediate hops in the
first place, under either capture API, without opting into different
(and more invasive) behavior. The real open question is narrower than
"one event or three": it's whether v1 should bother requesting
`redirect: "manual"` to *deliberately* surface intermediate hops as
separate events, which is real additional interception complexity
(the "response" DevLens would see in manual mode is a special opaque
redirect response, not a normal one) for a capability nothing in this
research suggests anyone has asked for yet. OTel's own .NET
conventions do report each redirect as a separate span — but that's
server-side instrumentation with access every hop server-to-server,
not a client observing what the browser chose to expose, so it's not
a directly comparable precedent here.

## Tradeoffs

### Semantic unit of observation

| | One event on completion | Two correlated events | Mutable event |
|---|---|---|---|
| Fits existing immutability (ADR-0001) | Yes, unchanged | Yes, unchanged | No — requires Core changes |
| Fits append-only Store (ADR-0004) | Yes, unchanged | Yes, unchanged | No — requires Core changes |
| Visibility into in-flight requests | None | Yes | Yes |
| New concept every consumer must learn | None | "these two events are one occurrence" | "this event can change under you" |
| Precedent in this project | Matches Runtime/Console exactly | None | None |
| Precedent in industry survey | OTel spans *do* have a start/end lifecycle, but that's a server-side tracing concept with its own infrastructure (trace context, span processors) that DevLens has no equivalent of | — | — |

### Interception mechanism

| | Monkey-patch `fetch`/`XHR` | Service Worker |
|---|---|---|
| Violates "never overwrite a globals" (ADR-0005 principle) | Yes, unavoidably | No |
| Cross-browser XHR reliability | Reliable | Documented gap: invisible to Firefox entirely (MSW's own finding) |
| Setup complexity for the host app | None — same `install()`/`uninstall()` shape as every other plugin | Requires registering and scoping a separate worker script |
| Precedent among tools with the same goal (observe, not mock) | Sentry, Datadog RUM, `@mswjs/interceptors` (Node) all patch directly | MSW (browser mocking use case, not observation) |

### Data captured by default

| | Method/URL/status/duration/outcome | + headers | + bodies |
|---|---|---|---|
| Privacy risk | Low | Real (auth headers, cookies) | High (arbitrary payload content) |
| Matches Sentry/Datadog defaults | Yes | No (opt-in in both) | No (opt-in in both, and costly in Sentry's case) |
| Useful without configuration | Yes | Situational | Situational |

## Architectural evaluation

Everything above explains what the industry converged on and why.
That's a different argument from "why should *DevLens* choose this" —
industry convergence is evidence, not by itself a reason binding on
this project. The table below evaluates each candidate against
DevLens's own existing, already-accepted commitments, not general
best practice:

| Principle | A (one event, on completion) | B (two correlated events) | C (mutable event) |
|---|---|---|---|
| Events stay immutable once reported (ADR-0001/0002) | Unchanged — Core needs no changes | Unchanged — each of the two events is still immutable individually | Violated — the entire point of C is updating an event after report |
| Store stays append-only (ADR-0004) | Unchanged | Unchanged | Violated — requires an `update()` Store never had |
| One real-world occurrence → one event (the pattern every existing source follows, never written down as its own ADR but true of Runtime and Console alike) | Holds exactly | Broken — "these two events are actually one occurrence" is a new concept nothing downstream currently knows how to interpret | Broken differently — one occurrence, but the event itself isn't a fixed fact anymore |
| Panel needs no new concept to render it | True — a Network event renders through the exact same `renderEventList`/`renderInspector` contract Runtime/Console events already use | False — the Panel would need to know two events can refer to each other, and decide how (or whether) to show a "pending" state | False — the Panel would need to know an already-rendered row can go stale and require re-rendering, which nothing in the current renderer contract supports |
| A future Export/Import needs no new concept | True — `serializeEvents()` already handles arbitrary flat `DevLensEvent[]` | False — export/import would need to preserve and validate the correlation between the two halves of a request | False — same problem, plus "what if only the start half was ever exported" |
| Plugin remains self-contained — its complexity doesn't leak into other packages | Yes — Network owns all of it; Panel, Export, and any future plugin are unaffected | Partial — correlation logic leaks into Panel (rendering a "pending" state), Export/Import (preserving the pairing), and implicitly into documentation every future contributor has to read | No — mutation leaks into Core itself, the one package every other package depends on |

Read as a whole, the table makes something visible that a prose
recommendation alone doesn't: **Candidate A isn't the option chosen
because it's the easiest to implement — it's the only one of the
three that doesn't ask any other part of DevLens to learn something
new.** B and C don't just cost more to build; they cost every
*downstream* consumer (Panel today, Import whenever it exists, any
future consumer of the Store nobody's written yet) something they'd
otherwise never have needed to know. Put another way: A has the
smallest architectural blast radius of the three — its complexity
starts and ends inside the Network plugin itself, where B's and C's
both escape it. That's a materially stronger argument than "three
unrelated companies happened to build it this way," even though the
industry survey is what surfaced the option in the first place.

The one thing this table can't settle: whether "no in-flight
visibility" (a real capability gap in A, not a rounding error) matters
enough to justify B's cost anyway. Nothing in the research so far
suggests a concrete DevLens use case demanding it — but that's an
absence of evidence, not evidence of absence, and is worth stating
as a real, acknowledged trade rather than something A wins for free.

## Candidate designs (not decisions)

**A. One event, reported on completion; method/URL/status/duration/
outcome only; query values redacted by default; monkey-patch both
`fetch` and `XHR`; explicit `outcome` enum (e.g. `success` /
`http-error` / `network-error` / `aborted` / `timeout`, with the
fetch-side caveat above documented) rather than inferring failure from
status code alone.**

This is the option every piece of research above points toward without
much tension between sources — it's the interception mechanism every
comparable *observability* tool (as opposed to MSW's *mocking* tool)
actually uses, its default data scope matches both Sentry's and
Datadog's shipped defaults, and its explicit-outcome idea is directly
backed by three independent sources (OpenTelemetry's spec, and real
user confusion in both Sentry's and Datadog's own issue trackers) all
converging on the same complaint. But the stronger argument is the
one in "Architectural evaluation" above: A is the only candidate that
asks nothing downstream — Core, Panel, or a future Export/Import — to
learn a new concept. Industry convergence is what surfaced this
option; DevLens's own existing commitments are why it fits.

**B. Two correlated events (start + complete).** Would give the Panel
something to show for in-flight requests, which A cannot. No project
precedent for "two events, one occurrence" exists anywhere in DevLens
today, and nothing in the research above suggests a *DevLens user* has
asked for in-flight visibility — that need would have to be argued for
on its own, not adopted because OTel's spans happen to have a
similar-looking start/end shape for an unrelated reason (distributed
tracing across process boundaries, which DevLens doesn't do).

**C. Mutable event, updated on completion.** Requires reopening
ADR-0001/0004. Nothing in this research turned up a reason strong
enough to justify that; every comparable tool surveyed represents a
completed request as an immutable record once it's done, which is
what DevLens already does for everything else.

## Open issues (genuinely unresolved, not decided by this document)

- Should URL path segments ever be normalized (`/users/123` →
  `/users/:id`)? Sentry's answer — an opt-in, host-app-configured hook
  — is one option; doing nothing and showing the raw URL is another.
  Neither has been chosen here.
- Exact `outcome` enum values and exact severity mapping per outcome
  (does a 404 count as `warn` or `error`? Does DevLens even want
  severity for Network the way it has for Console?) — not decided.
  See "Outcome and severity are different axes," above, for why these
  are two separate open questions, not one.
- Whether v1 captures response `Content-Type`/size without capturing
  the body itself (arguably lower-risk than full bodies, not discussed
  above) — not researched yet.
- Redirect handling, beyond what's covered in "Redirects," above —
  specifically, whether `fetch`'s `redirect: "manual"` mode (which
  would let DevLens observe each hop instead of only the browser's own
  followed chain) is worth the added complexity for v1. Leaning
  toward "no, not for v1" but not argued for here.
- Whether "aborted because the Panel's Network plugin itself was
  uninstalled mid-request" needs any special handling, or whether it's
  simply "no event reported, same as any other in-flight request that
  never gets a chance to report" — leaning toward the latter (matches
  Runtime/Console's existing idempotent-uninstall behavior) but not
  argued for here.
