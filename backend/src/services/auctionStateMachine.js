import { AUCTION_STATUSES } from '../models/index.js';
import { ApiError } from '../utils/appError.js';

export const { DRAFT, SCHEDULED, ACTIVE, ENDED, CANCELLED } = AUCTION_STATUSES;

/**
 * Explicit state machine for the auction lifecycle (multistate workflow).
 * Every legal transition has: permitted actor(s) and preconditions.
 * Anything not listed here is illegal by construction.
 */
export const TRANSITIONS = Object.freeze({
  [`${DRAFT}->${SCHEDULED}`]: {
    actors: ['SELLER', 'ADMIN'],
    precondition: (ctx) => {
      const now = ctx.now;
      if (!ctx.startsAt || !ctx.endsAt) return 'startsAt and endsAt must be provided when scheduling';
      if (ctx.startsAt.getTime() < now - 2000) return 'startsAt must not be in the past';
      if (ctx.endsAt.getTime() <= ctx.startsAt.getTime()) return 'endsAt must be after startsAt';
      return true;
    }
  },
  [`${SCHEDULED}->${ACTIVE}`]: {
    actors: ['SELLER', 'ADMIN'],
    precondition: (ctx) => {
      if (ctx.startsAt && ctx.startsAt.getTime() > ctx.now + 2000) {
        return 'auction cannot start before its scheduled startsAt';
      }
      return true;
    }
  },
  [`${SCHEDULED}->${CANCELLED}`]: {
    actors: ['SELLER', 'ADMIN'],
    precondition: () => true
  },
  [`${DRAFT}->${CANCELLED}`]: {
    actors: ['SELLER', 'ADMIN'],
    precondition: () => true
  },
  [`${ACTIVE}->${ENDED}`]: {
    actors: ['ADMIN', 'SYSTEM'],
    precondition: (ctx) => {
      if (!ctx.endsAt) return true;
      if (ctx.endsAt.getTime() > ctx.now + 2000) {
        return 'auction cannot end before its scheduled endsAt (deadline invariant)';
      }
      return true;
    }
  },
  [`${ACTIVE}->${CANCELLED}`]: {
    actors: ['SELLER', 'ADMIN'],
    precondition: () => true // bids presence checked by the service (fairness rule)
  }
  // ENDED, CANCELLED are terminal: no outgoing edges.
});

export function describeTransition(from, to) {
  return TRANSITIONS[`${from}->${to}`] ?? null;
}

export function isTerminal(status) {
  return status === ENDED || status === CANCELLED;
}

/**
 * Pure check returning { ok, reason?: string, rule? }. No DB access.
 */
export function checkTransition({ from, to, actor, now = new Date(), context = {} }) {
  const rule = describeTransition(from, to);
  if (!rule) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      reason: `Transition ${from} → ${to} does not exist`
    };
  }
  if (actor !== 'SYSTEM' && !rule.actors.includes(actor)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED_TRANSITION',
      reason: `Actor ${actor} cannot perform ${from} → ${to}`
    };
  }
  const passed = rule.precondition({ ...context, now: now.getTime() });
  if (passed !== true) {
    return { ok: false, code: 'PRECONDITION_FAILED', reason: passed };
  }
  return { ok: true, rule };
}

export function assertTransition({ from, to, actor, context, now }) {
  const result = checkTransition({ from, to, actor, context, now });
  if (!result.ok) {
    throw ApiError.conflict(result.code, result.reason, { from, to });
  }
  return result.rule;
}

export function actorFor(user) {
  if (!user) return 'GUEST';
  return user.role === 'ADMIN' ? 'ADMIN' : 'SELLER';
}