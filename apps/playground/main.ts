import { createEventBus, createEventStore, connectStoreToBus } from "@devlens/core";
import { createRuntimePlugin } from "@devlens/runtime";
import { createConsolePlugin } from "@devlens/console";
import { createPanel } from "@devlens/panel";


const bus = createEventBus();
const store = createEventStore();
connectStoreToBus(bus, store);

const runtime = createRuntimePlugin(bus);
const consolePlugin = createConsolePlugin(bus);
const panel = createPanel(store);

runtime.install();
consolePlugin.install();
panel.install();

// Temporary visualization until the Panel package exists. This
// intentionally feeds console-plugin events back into console.table(),
// which the Console plugin's recursion guard makes safe — do not "fix"
// this by routing around console output, that's the point.

// Subscribing AFTER console.install() means this subscriber's own
// console.table call goes through the interceptor too — that's fine and
// expected; it exercises the recursion guard for real, in a browser,
// rather than only in a unit test.
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