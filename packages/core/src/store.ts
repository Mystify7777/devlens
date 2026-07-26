import type { DevLensEvent, EventCategory } from "./types";
import type { EventBus } from "./event-bus";
import { RingBuffer } from "./collections/ring-buffer";
import { DEFAULT_STORE_SIZE } from "./constants";

export type StoreHandler = (event: DevLensEvent) => void;

export interface EventStoreOptions {
  /** Max events retained. Default 10,000 — larger than the bus's replay
   * buffer, since the Store is meant to be the longer-lived canonical log
   * a Panel or plugin queries, not just a short dispatch-continuity buffer. */
  maxEvents?: number;
}

/**
 * The Event Store. Deliberately boring: receive, save, query. It does not
 * generate IDs or timestamps (the bus already did), does not run
 * middleware, and does not manage its own replay semantics — it gets
 * history for free by subscribing to the bus with `{ replay: true }`.
 *
 * If you find yourself adding any of those things to the Store, stop —
 * that responsibility belongs on the Event Bus, not here.
 */
export interface EventStore {
  /** Adds an event directly. Normally called automatically via the bus
   * subscription — exposed publicly for tests or manual seeding. */
  add(event: DevLensEvent): void;
  clear(): void;
  getAll(): DevLensEvent[];
  getByCategory(category: EventCategory): DevLensEvent[];
  find(predicate: (event: DevLensEvent) => boolean): DevLensEvent[];
  /** Notified whenever an event is added, whether via the bus or add(). */
  subscribe(handler: StoreHandler): () => void;
  /** Unsubscribes from the bus and clears internal state. */
  destroy(): void;
}

export function createEventStore(
  bus: EventBus,
  options: EventStoreOptions = {}
): EventStore {
  const maxEvents = options.maxEvents ?? DEFAULT_STORE_SIZE;
  const buffer = new RingBuffer<DevLensEvent>(maxEvents);
  let subscribers: StoreHandler[] = [];

  function notify(event: DevLensEvent) {
    for (const handler of subscribers) {
      handler(event);
    }
  }

  function add(event: DevLensEvent) {
    buffer.push(event);
    notify(event);
  }

  // Backfills existing bus history immediately, then stays live for
  // every future report() — the Store never has to think about "did I
  // miss anything before I existed."
  const unsubscribeFromBus = bus.subscribe("*", add, { replay: true });

  return {
    add,
    clear() {
      buffer.clear();
    },
    getAll() {
      return buffer.toArray();
    },
    getByCategory(category) {
      return buffer.toArray().filter((e) => e.category === category);
    },
    find(predicate) {
      return buffer.toArray().filter(predicate);
    },
    subscribe(handler) {
      subscribers.push(handler);
      return () => {
        subscribers = subscribers.filter((h) => h !== handler);
      };
    },
    destroy() {
      unsubscribeFromBus();
      subscribers = [];
      buffer.clear();
    },
  };
}