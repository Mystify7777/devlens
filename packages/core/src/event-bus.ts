import type {
  DevLensEvent,
  DevLensEventInput,
  EventCategory,
  MutableDevLensEvent,
} from "./types";
import { generateEventId } from "./id";
import { EventBusDestroyedError, MiddlewareError } from "./errors";
import { RingBuffer } from "./collections/ring-buffer";
import { deepFreeze } from "./utils/deep-freeze";
import { DEFAULT_REPLAY_BUFFER_SIZE } from "./constants";

export type EventHandler = (event: DevLensEvent) => void;

/**
 * next() may be called with no arguments (continue with the current
 * draft — supports mutate-in-place style) or with a replacement event
 * (supports spread/immutable style). Both are valid; neither is mandated.
 */
export type EventMiddleware = (
  event: MutableDevLensEvent,
  next: (event?: MutableDevLensEvent) => void
) => void;

export interface SubscribeOptions {
  replay?: boolean;
}

export interface EventBusOptions {
  /** Max events retained in the internal replay buffer. Default 1000. */
  maxHistory?: number;
}

export interface EventBus {
  report(input: DevLensEventInput): DevLensEvent;
  subscribe(
    category: EventCategory | "*",
    handler: EventHandler,
    options?: SubscribeOptions
  ): () => void;
  unsubscribe(handler: EventHandler): void;
  addMiddleware(middleware: EventMiddleware): void;
  clear(): void;
  getEvents(): DevLensEvent[];
  destroy(): void;
}

interface Subscription {
  category: EventCategory | "*";
  handler: EventHandler;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const maxHistory = options.maxHistory ?? DEFAULT_REPLAY_BUFFER_SIZE;

  let subscriptions: Subscription[] = [];
  let middlewares: EventMiddleware[] = [];
  const replayBuffer = new RingBuffer<DevLensEvent>(maxHistory);
  let destroyed = false;

  function assertNotDestroyed(action: string) {
    if (destroyed) {
      throw new EventBusDestroyedError(action);
    }
  }

  function runMiddleware(
    initial: MutableDevLensEvent,
    done: (event: MutableDevLensEvent) => void
  ) {
    let index = -1;
    let current = initial;

    function dispatch(i: number, replacement?: MutableDevLensEvent) {
      if (i <= index) {
        throw new MiddlewareError(
          "EventBus middleware called next() multiple times for the same event"
        );
      }
      index = i;
      if (replacement) {
        current = replacement;
      }
      const middleware = middlewares[i];
      if (!middleware) {
        done(current);
        return;
      }
      middleware(current, (nextEvent) => dispatch(i + 1, nextEvent));
    }

    dispatch(0);
  }

  function dispatchToSubscribers(event: DevLensEvent) {
    for (const sub of subscriptions) {
      if (sub.category === "*" || sub.category === event.category) {
        sub.handler(event);
      }
    }
  }

  return {
    report(input) {
      assertNotDestroyed("report");

      const draft: MutableDevLensEvent = {
        ...input,
        id: input.id ?? generateEventId(),
        version: input.version ?? 1,
        timestamp: input.timestamp ?? Date.now(),
      };

      let finalDraft = draft;
      runMiddleware(draft, (result) => {
        finalDraft = result;
      });

      const finalEvent = deepFreeze(finalDraft) as DevLensEvent;

      replayBuffer.push(finalEvent);
      dispatchToSubscribers(finalEvent);
      return finalEvent;
    },

    subscribe(category, handler, subOptions = {}) {
      assertNotDestroyed("subscribe");

      const sub: Subscription = { category, handler };
      subscriptions.push(sub);

      if (subOptions.replay) {
        replayBuffer.forEach((event) => {
          if (category === "*" || event.category === category) {
            handler(event);
          }
        });
      }

      return () => {
        subscriptions = subscriptions.filter((s) => s !== sub);
      };
    },

    unsubscribe(handler) {
      assertNotDestroyed("unsubscribe");
      subscriptions = subscriptions.filter((s) => s.handler !== handler);
    },

    addMiddleware(middleware) {
      assertNotDestroyed("addMiddleware");
      middlewares.push(middleware);
    },

    clear() {
      assertNotDestroyed("clear");
      replayBuffer.clear();
    },

    getEvents() {
      assertNotDestroyed("getEvents");
      return replayBuffer.toArray();
    },

    destroy() {
      if (destroyed) return; // idempotent
      subscriptions = [];
      middlewares = [];
      replayBuffer.clear();
      destroyed = true;
    },
  };
}