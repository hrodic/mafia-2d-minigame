// @ts-check
// Synchronous in-process event bus for simulation -> presentation facts.
// Contract and catalog: EVENTS.md. Rules:
// - handlers are isolated: a throw is caught + logged, never breaks the caller;
// - dispatch uses a snapshot: (un)subscribing during emit affects the next emit;
// - events are past-tense facts; subscribers must not mutate gameplay state.
// - sim/ emits events but never imports the subscribers (ui/render/audio/net).

/** @type {Map<string, Set<(payload: any) => void>>} */
const handlersByType = new Map();

function assertType(type) {
  if (typeof type !== 'string' || type.length === 0) {
    throw new TypeError('event type must be a non-empty string');
  }
}

function assertHandler(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('event handler must be a function');
  }
}

/**
 * Subscribe a handler to an event type.
 * @param {string} type Event name, e.g. "unit:damaged".
 * @param {(payload: any) => void} handler
 * @returns {() => void} Idempotent unsubscribe function.
 */
export function on(type, handler) {
  assertType(type);
  assertHandler(handler);

  let handlers = handlersByType.get(type);
  if (!handlers) {
    handlers = new Set();
    handlersByType.set(type, handlers);
  }
  handlers.add(handler);

  let subscribed = true;
  return function unsubscribe() {
    if (!subscribed) return;
    subscribed = false;
    const current = handlersByType.get(type);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlersByType.delete(type);
  };
}

/**
 * Remove a handler from an event type.
 * @param {string} type
 * @param {(payload: any) => void} handler
 */
export function off(type, handler) {
  assertType(type);
  assertHandler(handler);

  const handlers = handlersByType.get(type);
  if (!handlers) return;
  handlers.delete(handler);
  if (handlers.size === 0) handlersByType.delete(type);
}

/**
 * Synchronously notify every subscriber of an event type.
 * @param {string} type
 * @param {any} [payload]
 */
export function emit(type, payload) {
  assertType(type);

  const handlers = handlersByType.get(type);
  if (!handlers || handlers.size === 0) return;

  // Snapshot so subscribe/unsubscribe during dispatch is deterministic.
  for (const handler of Array.from(handlers)) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`[events] handler for "${type}" threw`, error);
    }
  }
}

/** Remove every subscriber. Intended for tests and full match resets. */
export function clear() {
  handlersByType.clear();
}
