import type { DevLensEventInput } from "@devlens/core";

function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

export function normalizeErrorEvent(event: {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}): DevLensEventInput {
  const stack = event.error instanceof Error ? event.error.stack : undefined;

  return {
    origin: "error-listener",
    category: "runtime",
    severity: "error",
    title: "Uncaught Error",
    message: event.message,
    stack,
    context: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  };
}

export function normalizeUnhandledRejection(event: {
  reason: unknown;
}): DevLensEventInput {
  const { message, stack } = describeReason(event.reason);

  return {
    origin: "unhandled-rejection-listener",
    category: "runtime",
    severity: "error",
    title: "Unhandled Promise Rejection",
    message,
    stack,
  };
}