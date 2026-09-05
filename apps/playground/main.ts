import { createEventBus, createEventStore, connectStoreToBus } from "@devlens/core";
import { createRuntimePlugin } from "@devlens/runtime";
import { createConsolePlugin } from "@devlens/console";
import { createNetworkPlugin } from "@devlens/network";
import { createPanel } from "@devlens/panel";
import { mountReactDemo } from "./react-demo";


const bus = createEventBus();
const store = createEventStore();
connectStoreToBus(bus, store);

const runtime = createRuntimePlugin(bus);
const consolePlugin = createConsolePlugin(bus);
const network = createNetworkPlugin(bus);
const panel = createPanel(store);

// Installation order is not architecturally significant here: each
// plugin patches a disjoint set of globals (Runtime: window error
// listeners; Console: console.* methods; Network: window.fetch +
// XMLHttpRequest.prototype), so no plugin's install() can observe or
// interfere with another's. See the v0.5.2 Network Integration
// investigation for the full ordering analysis — this comment records
// the conclusion, not a new decision.
runtime.install();
consolePlugin.install();
network.install();
panel.install();

// React demo (Issue #11): mounted against the same shared `bus` as
// every other capture source above. `@devlens/react`'s error boundary
// is not a `Plugin` (no install()/uninstall() — see ADR-0013), so it
// is mounted directly via React's own render tree instead of the
// install-order block above. JSX is isolated to `react-demo.tsx`;
// this file stays plain TypeScript.
const reactDemoRoot = document.getElementById("react-demo-root");
if (reactDemoRoot) {
  mountReactDemo(bus, reactDemoRoot);
}

// Mirror the event stream to the browser console for development.
// The embedded Panel remains the primary visualization.

// Subscribing AFTER console.install() means this subscriber's own
// console.table call goes through the interceptor too — that's fine and
// expected; it exercises the recursion guard for real, in a browser,
// rather than only in a unit test. This also applies unchanged to
// Network-sourced events: a Fetch/XHR completion reports through the
// same bus and reaches this same subscriber — no Network-specific
// handling needed. (console.table itself is not one of Console's
// intercepted methods — only log/info/debug/warn/error are — so this
// call passes straight through to the real console.table regardless
// of which capture source produced the triggering event.)
bus.subscribe("*", (event) => {
  // eslint-disable-next-line no-console
  console.table(event);
});

document.getElementById("btn-throw")?.addEventListener("click", () => {
  throw new Error("Playground: intentional thrown error");
});

document.getElementById("btn-reject")?.addEventListener("click", () => {
  Promise.reject(new Error("Playground: intentional rejection"));
});

document.getElementById("btn-log")?.addEventListener("click", () => {
  console.log("Playground: a plain console.log", { foo: "bar" });
});

document.getElementById("btn-warn")?.addEventListener("click", () => {
  console.warn("Playground: something worth a second look");
});

document.getElementById("btn-error")?.addEventListener("click", () => {
  console.error("Playground: something went wrong (not thrown)");
});

// --- Network demo controls -------------------------------------------
//
// Deterministic, same-origin, local targets only — no external network
// dependency (per the v0.5.2 Network Integration milestone's explicit
// requirement). `/devlens-sample.json` is a static asset served from
// this app's own `public/` directory by Vite's dev server; a request
// for a *missing* path with a file extension reliably 404s (verified
// against Vite's dev server directly — an extensionless missing path
// instead falls back to index.html via SPA-fallback middleware, which
// would not exercise the http-error classification path at all).

const SAMPLE_URL = "/devlens-sample.json";
const MISSING_URL = "/devlens-sample-missing.json";

document.getElementById("btn-fetch-success")?.addEventListener("click", () => {
  fetch(SAMPLE_URL).catch(() => {
    // Intentionally ignored here — Network's own interceptor already
    // observes and reports this request via bus.report() regardless
    // of what the Playground itself does with the settled Promise.
  });
});

document.getElementById("btn-fetch-error")?.addEventListener("click", () => {
  fetch(MISSING_URL).catch(() => {
    // See btn-fetch-success — same reasoning.
  });
});

document.getElementById("btn-xhr-success")?.addEventListener("click", () => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", SAMPLE_URL, true);
  xhr.send();
});

document.getElementById("btn-xhr-error")?.addEventListener("click", () => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", MISSING_URL, true);
  xhr.send();
});
