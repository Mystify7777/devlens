import type { EventBus } from "@devlens/core";
import { normalizeErrorEvent } from "../normalizers/runtime-normalizer";

export function createErrorListener(bus: EventBus) {
  return function onError(event: ErrorEvent) {
    bus.report(
      normalizeErrorEvent({
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      })
    );
  };
}