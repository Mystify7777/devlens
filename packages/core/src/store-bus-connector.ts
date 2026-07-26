import type { EventBus } from "./event-bus";
import type { EventStore } from "./store";

export interface ConnectStoreToBusOptions {
  /** Backfill the store with the bus's existing replay buffer on connect. Default true. */
  replay?: boolean;
}

/**
 * Wires a Store to an Event Bus as one possible event source. The Store
 * itself has no idea this connection exists — it just receives add() calls.
 * This keeps "storage" and "where events come from" as separate concerns,
 * so a future connector (connectStoreToWebSocket, importSession, etc.) can
 * feed the exact same Store without the Store needing to change at all.
 */
export function connectStoreToBus(
  bus: EventBus,
  store: EventStore,
  options: ConnectStoreToBusOptions = {}
): () => void {
  const replay = options.replay ?? true;
  return bus.subscribe("*", (event) => store.add(event), { replay });
}