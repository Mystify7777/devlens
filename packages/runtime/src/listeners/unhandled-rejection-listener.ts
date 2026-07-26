import type { EventBus } from "@devlens/core";
import { normalizeUnhandledRejection } from "../normalizers/runtime-normalizer";

export function createUnhandledRejectionListener(bus: EventBus) {
  return function onUnhandledRejection(event: PromiseRejectionEvent) {
    bus.report(normalizeUnhandledRejection({ reason: event.reason }));
  };
}