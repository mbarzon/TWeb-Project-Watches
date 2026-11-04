import { EventEmitter } from 'node:events';

/**
 * In-process realtime event bus (RTM package).
 * The SSE hub subscribes; REST services publish. Events carry an
 * application-level `seq` assigned by producers (bid id, closer batch id)
 * so clients can detect gaps and reorder stale deliveries.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export const CHANNELS = Object.freeze({
  global: 'auctions:global',
  auction: (id) => `auction:${id}`,
  user: (id) => `user:${id}`
});

let monotonic = 0;

export function publish(channel, event) {
  const envelope = {
    ...event,
    channel, // specific channel this event was published to
    busSeq: ++monotonic, // hub-local counter for SSE Last-Event-ID bookkeeping
    timestamp: new Date().toISOString()
  };
  bus.emit(CHANNELS.global, envelope);
  return envelope;
}

export function subscribe(channel, listener) {
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

export function unsubscribe(channel, listener) {
  bus.off(channel, listener);
}