import type { DevLensEvent, EventCategory } from "./types";
import { RingBuffer } from "./collections/ring-buffer";
import { DEFAULT_STORE_SIZE } from "./constants";

export type StoreHandler = (event: DevLensEvent) => void;

export interface EventStoreOptions {
  /** Max events retained. Default 10,000. */
  maxEvents?: number;
}

/**
 * The Event Store. A pure data structure: receive, save, query. It has
 * no knowledge of where events come from — the Event Bus is one possible
 * source, but so could a WebSocket stream, an imported session file, or
 * a test harness. Wiring a Store to a live source is a separate concern;
 * see connectStoreToBus() for the Event Bus case.
 */
export interface EventStore {
  add(event: DevLensEvent): void;
  /**
   * Append multiple already-valid, already-frozen events in the supplied
   * order, then notify subscribers exactly once. Performs no validation
   * and no freezing — that is the caller's responsibility before calling
   * this method. An empty array is a true no-op: no buffer mutation, no
   * subscriber notification.
   */
  addMany(events: DevLensEvent[]): void;
  /** The configured maximum number of events this Store retains. Fixed
   * for the Store's lifetime; does not reflect current fill level. */
  readonly capacity: number;
  clear(): void;
  getAll(): DevLensEvent[];
  getByCategory(category: EventCategory): DevLensEvent[];
  filter(predicate: (event: DevLensEvent) => boolean): DevLensEvent[];
  subscribe(handler: StoreHandler): () => void;
  destroy(): void;
}

export function createEventStore(options: EventStoreOptions = {}): EventStore {
  const maxEvents = options.maxEvents ?? DEFAULT_STORE_SIZE;
  const buffer = new RingBuffer<DevLensEvent>(maxEvents);
  let subscribers: StoreHandler[] = [];

  function notify(event: DevLensEvent) {
    for (const handler of subscribers) {
      handler(event);
    }
  }

  return {
    add(event) {
      buffer.push(event);
      notify(event);
    },
    addMany(events) {
      if (events.length === 0) return;
      for (const event of events) {
        buffer.push(event);
      }
      notify(events[events.length - 1]);
    },
    get capacity() {
      return maxEvents;
    },
    clear() {
      buffer.clear();
    },
    getAll() {
      return buffer.toArray();
    },
    getByCategory(category) {
      return buffer.toArray().filter((e) => e.category === category);
    },
    filter(predicate) {
      return buffer.toArray().filter(predicate);
    },
    subscribe(handler) {
      subscribers.push(handler);
      return () => {
        subscribers = subscribers.filter((h) => h !== handler);
      };
    },
    destroy() {
      subscribers = [];
      buffer.clear();
    },
  };
}