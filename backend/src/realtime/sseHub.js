import { env } from '../config/env.js';
import { bus, CHANNELS, subscribe } from './eventBus.js';

/**
 * RTM package: Server-Sent Events hub.
 *
 * - Per-auction streams and one global stream; updates arrive without refresh.
 * - The hub listens to the bus exactly once and fans out to clients by
 *   channel membership, so the replay buffer records every event exactly once.
 * - Events carry an SSE `id` (busSeq): reconnecting clients send Last-Event-ID
 *   and receive the missed backlog (RTM reconnect evidence).
 * - Authorization: token per stream; user channels restricted to their owner.
 */
class SseHub {
  constructor() {
    this.clients = new Set(); // { res, userId, channels:Set, unsub }
    this.buffer = []; // { busSeq, channel, event }
    this.nextBusSeq = 0;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    subscribe(CHANNELS.global, (envelope) => this.handle(envelope));
  }

  /** Single bus listener: record once, then fan out to matching clients. */
  handle(envelope) {
    const { channel } = envelope;
    const busSeq = ++this.nextBusSeq;
    this.buffer.push({ busSeq, channel, event: envelope });
    if (this.buffer.length > env.sseBufferSize) {
      this.buffer.splice(0, this.buffer.length - env.sseBufferSize);
    }
    for (const client of this.clients) {
      if (this.wants(client, channel)) {
        this.write(client, busSeq, envelope);
      }
    }
  }

  write(client, id, event) {
    if (client.res.writableEnded) return;
    client.res.write(`id: ${id}\nevent: ${event.type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  // Membership rule: an event reaches a client when it was published on a
  // channel the client subscribed to, or the client is a GLOBAL listener
  // (global clients observe every event; global events carry the special
  // 'auctions:global' channel).
  wants(client, envelopeChannel) {
    return client.channels.has(envelopeChannel) || client.channels.has(CHANNELS.global);
  }

  replayFor(channels, sinceBusSeq) {
    return this.buffer
      .filter((r) => channels.has(r.channel) || channels.has(CHANNELS.global))
      .filter((r) => r.busSeq > sinceBusSeq)
      .map((r) => ({ id: r.busSeq, event: r.event }));
  }

  /**
   * Handles GET /api/:kind/:id/events after requireAuth resolved req.user.
   * kind: 'auctions' | 'users' | 'global'
   */
  async connect(req, res, { kind, id, lastEventId }) {
    const user = req.user;

    let channel;
    if (kind === 'auctions') {
      channel = CHANNELS.auction(id);
    } else if (kind === 'users') {
      // object-level: users may only listen to their OWN event channel
      if (Number(id) !== user.id && user.role !== 'ADMIN') {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'You may only listen to your own events' }
        });
        return;
      }
      channel = CHANNELS.user(id);
    } else {
      channel = CHANNELS.global;
    }

    this.start();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');

    // global listeners observe everything; scoped listeners only their channel
    const client = {
      res,
      userId: user.id,
      channels: kind === 'global' ? new Set([CHANNELS.global]) : new Set([channel])
    };
    this.clients.add(client);

    // Replay missed events when the client announces its cursor.
    // Presence (even "0") counts: a client reconnecting from scratch asks
    // for the whole backlog; absence means a fresh connection (new history).
    const hasCursor = lastEventId !== null && lastEventId !== undefined;
    const since = Number.parseInt(lastEventId ?? '0', 10) || 0;
    if (hasCursor) {
      for (const missed of this.replayFor(client.channels, since)) {
        this.write(client, missed.id, missed.event);
      }
    }
    // The connected event's id equals the highest recorded busSeq, i.e. the
    // exact point up to which this client has now seen everything.
    this.write(client, this.nextBusSeq, {
      type: 'connected',
      channel,
      userId: user.id,
      timestamp: new Date().toISOString()
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, env.sseHeartbeatMs);

    const close = () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    };
    req.on('close', close);
    res.on('close', close);

    return client;
  }

  clientCount() {
    return this.clients.size;
  }
}

export const sseHub = new SseHub();

/** Express handler factory for SSE endpoints. */
export function sseEndpoint(kind) {
  return async (req, res, next) => {
    try {
      const lastEventId = req.headers['last-event-id'] ?? req.query.lastEventId ?? null;
      await sseHub.connect(req, res, { kind, id: req.params.id, lastEventId });
    } catch (err) {
      next(err);
    }
  };
}