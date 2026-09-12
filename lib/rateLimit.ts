/**
 * A small, dependency-free request limiter.
 *
 * ---------------------------------------------------------------------------
 * THE LIMITATION, STATED UP FRONT
 * ---------------------------------------------------------------------------
 * The counters live in the memory of the process that serves the request. On
 * Vercel every serverless function is its own isolate, several run at once, and
 * they are recycled without notice. So this is **per-instance, not global**:
 * a caller spread across N warm instances gets roughly N times the budget, and
 * every cold start hands out a fresh one.
 *
 * That is a real weakness and it is not hidden here. It is still worth having:
 *
 *   - The exploits this exists to stop are *loops* — one client, one socket,
 *     as fast as it can go. Those requests keep landing on the same warm
 *     instance, because that is what keeps it warm. The tight loop is the case
 *     it actually catches.
 *   - Nothing downstream depends on the limiter being exact. Exceeding a budget
 *     degrades a response, it never corrupts one.
 *
 * **The real fix is a shared store** — one atomic counter per key in Redis,
 * Postgres, or whatever the deployment already runs — so that every instance
 * reads and writes the same number. That is new infrastructure and a new
 * dependency, so it is deliberately not done here. Anyone adding it should
 * keep the `consume`/`RateLimitResult` shape below and swap the `Map` for the
 * store; no call site needs to change.
 *
 * ---------------------------------------------------------------------------
 * MEMORY
 * ---------------------------------------------------------------------------
 * A `Map` keyed by IP that is never pruned is itself the denial-of-service
 * vector it was added to prevent — a few million distinct forged IPs and the
 * instance is out of heap. Two bounds, both in `sweep()`:
 *
 *   - expired buckets are dropped on a timer (at most one pass a minute), and
 *   - the table has a hard ceiling; over it, the oldest buckets are evicted in
 *     insertion order, which is the only direction a `Map` can cheaply give us.
 *
 * Eviction under pressure means a caller can, in principle, wash their own
 * counter out by flooding the table with new keys. That costs them far more
 * requests than the budget they would be buying back, and it is bounded by the
 * same limiter on the way in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession, type SessionUser } from './auth';

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/** One fixed window: `limit` requests per `windowMs`. */
export interface RateWindow {
  limit: number;
  windowMs: number;
}

/**
 * A named budget. More than one window is allowed and is usually right: a short
 * window sets the burst a person can produce, a long one sets the bill a script
 * can run up overnight. Every window has to pass.
 *
 * `name` namespaces the counters, so the same caller is metered separately per
 * tier rather than having one budget drained by whichever route they touch first.
 */
export interface RateTier {
  name: string;
  /** Readonly so the `as const` table below satisfies it without being copied. */
  windows: readonly RateWindow[];
}

export interface RateLimitResult {
  ok: boolean;
  /** The limit of the window that is tightest right now. */
  limit: number;
  /** Requests left in that window; 0 when rejected. */
  remaining: number;
  /** Whole seconds until the caller may retry. At least 1 when rejected. */
  retryAfterSeconds: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/* -------------------------------------------------------------------------- */
/* Tiers                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The budgets, and why each is the size it is.
 *
 * The numbers are chosen against two facts: what a person doing the thing
 * looks like, and what the request costs us if they are not a person. Nothing
 * here is meant to be felt by a human using the product — a budget a real user
 * trips is a bug report, not a defence — so each one sits comfortably above the
 * busiest plausible session and still cuts an unattended loop by three or four
 * orders of magnitude.
 */
export const RATE_TIERS = {
  /**
   * `GET /api/jobs?q=…` for a signed-out visitor.
   *
   * Every distinct query string is a cache miss: one billed embedding call and
   * one permanent ~6 KB `QueryVector` row, spendable by anyone in a loop. The
   * search box debounces at 250 ms, so a fast typist settles maybe five or six
   * queries a minute; 20 is well clear of that. The hourly window is what stops
   * the patient version of the same attack — a request every four seconds,
   * forever — which the per-minute window alone would wave through.
   */
  SEARCH_ANON: { name: 'search-anon', windows: [{ limit: 20, windowMs: MINUTE }, { limit: 300, windowMs: HOUR }] },

  /**
   * The same path for a signed-in caller. Looser, because the key is a user id
   * rather than a shared NAT address and because a seeker genuinely does search
   * harder than a visitor — but not unlimited: registration is open, so an
   * account is not evidence of good faith.
   */
  SEARCH_AUTH: { name: 'search-auth', windows: [{ limit: 60, windowMs: MINUTE }, { limit: 900, windowMs: HOUR }] },

  /**
   * Interactive generation: drafting help, the inclusivity check, screening
   * suggestions, a match explanation. One model call each, a second or two,
   * clicked by hand.
   *
   * An employer iterating hard on a posting might click ten of these in a
   * minute. 15 covers that; 120 an hour covers a whole afternoon of writing and
   * still caps one account's use of the endpoint as an unmetered LLM proxy at
   * something a bill can survive.
   */
  AI_INTERACTIVE: { name: 'ai-interactive', windows: [{ limit: 15, windowMs: MINUTE }, { limit: 120, windowMs: HOUR }] },

  /**
   * Expensive generation: résumé parsing (a whole document uploaded to the
   * model), the application coach, the pipeline summary (up to 60 candidate
   * records in the prompt). Seconds of latency and many times the tokens of an
   * interactive call.
   *
   * Nobody parses their résumé five times a minute or asks for six pipeline
   * summaries an hour by hand, so this is tight on purpose: it is the endpoint
   * class where one determined account costs the most per request.
   */
  AI_EXPENSIVE: { name: 'ai-expensive', windows: [{ limit: 5, windowMs: MINUTE }, { limit: 30, windowMs: HOUR }] },

  /**
   * Admin fan-out: a full re-index, an alert run. Each one walks the corpus and
   * can spend hundreds of model calls in a single request, so the budget is set
   * by what the job costs rather than by how often a person might click it.
   * Two an hour is more than a human operator needs and far less than a stuck
   * cron loop would ask for.
   */
  ADMIN_BULK: { name: 'admin-bulk', windows: [{ limit: 2, windowMs: HOUR }] },

  /**
   * Credential stuffing: `POST /api/auth` with `login` or `register`.
   *
   * Keyed by IP — there is no session yet, and keying by the submitted email
   * would be worse than useless: it would let anyone lock a named victim out of
   * their own account, and the difference between a limited key and an
   * unlimited one would confirm whether that account exists.
   *
   * Deliberately generous for a shared address (an office, a campus, a phone
   * network all arrive as one IP) and still nowhere near enough to stuff a
   * credential list, which needs thousands of guesses to be worth running.
   * Successful logins are refunded (see `release`), so the budget is spent by
   * failures and by account creation, which is what it is for.
   */
  AUTH_ATTEMPT: { name: 'auth-attempt', windows: [{ limit: 20, windowMs: 5 * MINUTE }, { limit: 100, windowMs: HOUR }] },

  /**
   * Ordinary authenticated writes: applying, messaging, posting a job. Cheap
   * individually, but each one writes a row somebody else has to read, and
   * posting a job also queues an embedding. This is an anti-flood floor rather
   * than a cost control, so it sits high enough that no honest client notices.
   */
  WRITE: { name: 'write', windows: [{ limit: 30, windowMs: MINUTE }, { limit: 300, windowMs: HOUR }] },

  /**
   * File uploads. Every accepted file is bytes through our function and an
   * object in Cloudinary that nothing garbage-collects, so the ceiling is lower
   * than for a row in Postgres.
   */
  UPLOAD: { name: 'upload', windows: [{ limit: 10, windowMs: MINUTE }, { limit: 40, windowMs: HOUR }] },
} as const satisfies Record<string, RateTier>;

/* -------------------------------------------------------------------------- */
/* Caller identity                                                             */
/* -------------------------------------------------------------------------- */

/** The first address in a comma-separated forwarding header. */
function firstHop(value: string): string {
  const hop = value.split(',')[0]?.trim();
  // Length-capped: the key ends up in a Map, and a header is attacker-supplied.
  return hop ? hop.slice(0, 64) : '';
}

/**
 * The caller's address, as well as it can be known behind a proxy.
 *
 * `x-forwarded-for` is appended to by every hop, so its leftmost entry is
 * whatever the *client* chose to send unless something in front of us
 * overwrites it. On Vercel something does: the platform sets
 * `x-vercel-forwarded-for` and `x-real-ip` itself, from the socket, after
 * discarding what arrived. Those two are therefore tried first and
 * `x-forwarded-for` is the last resort rather than the first choice.
 *
 * A caller we cannot place at all shares one bucket. That is the strict
 * reading — they are rate-limited together — and it only happens off a proxy,
 * which in practice means local development.
 */
export function clientIp(req: NextRequest): string {
  return (
    firstHop(req.headers.get('x-vercel-forwarded-for') ?? '') ||
    firstHop(req.headers.get('x-real-ip') ?? '') ||
    firstHop(req.headers.get('x-forwarded-for') ?? '') ||
    'unknown'
  );
}

/**
 * Who to meter.
 *
 * A verified user id when there is one: it survives a changed address, it is
 * the thing an abusive account is actually attached to, and it stops one user
 * on a shared network from spending a colleague's budget. IP otherwise, which
 * is all an anonymous caller gives us.
 *
 * `session` is a parameter rather than always re-read because most callers have
 * already verified the token through `requireRole`/`requireAuth`, and verifying
 * the same JWT twice per request is pure waste. Pass `undefined` to have it
 * read here; pass `null` to force IP keying (what the auth routes want).
 */
export function callerKey(req: NextRequest, session?: SessionUser | null): string {
  const user = session === undefined ? getSession(req) : session;
  return user ? `u:${user.id}` : `ip:${clientIp(req)}`;
}

/* -------------------------------------------------------------------------- */
/* Counters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One caller's standing in one tier: a count and an expiry per window, held
 * positionally against `RateTier.windows`.
 *
 * Fixed windows rather than a sliding log. A log of timestamps is more precise
 * at the boundary and costs an array per caller to store and a scan to read;
 * the precision buys nothing here, because the consequence of being one request
 * over is a degraded response and not a locked door.
 */
interface Bucket {
  counts: number[];
  resets: number[];
}

const buckets = new Map<string, Bucket>();

/** Above this many live buckets, the oldest are evicted. ~64 bytes each. */
const MAX_BUCKETS = 20_000;
/**
 * How far down an eviction trims. Deliberately below the ceiling: trimming back
 * to exactly `MAX_BUCKETS` would leave the table over the line again on the
 * very next new key, and turn a flood of distinct keys into a full scan per
 * request. This way the scan is amortised over the 2,000 keys of headroom.
 */
const BUCKET_LOW_WATER = 18_000;
/** No more than one full pass per interval, however busy the instance is. */
const SWEEP_INTERVAL_MS = MINUTE;

let lastSweep = 0;

/**
 * Drops buckets whose every window has expired, then enforces the ceiling.
 *
 * Called from `consume`, not from a timer: a `setInterval` in a serverless
 * function keeps the isolate alive and runs against a heap that may already
 * have been frozen between invocations. Sweeping on the request path costs a
 * pass over a bounded table at most once a minute.
 */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS && buckets.size <= MAX_BUCKETS) return;
  lastSweep = now;

  for (const [key, bucket] of buckets) {
    // Expired in every window: the caller's slate is clean either way, so the
    // row carries no information worth its memory.
    if (bucket.resets.every((reset) => reset <= now)) buckets.delete(key);
  }

  // Still over the ceiling after sweeping — a genuine flood of distinct keys.
  // A Map iterates in insertion order, so this drops the least recently created.
  if (buckets.size > MAX_BUCKETS) {
    const excess = buckets.size - BUCKET_LOW_WATER;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/**
 * Counts one request against `tier` for `key`, and says whether it may proceed.
 *
 * A rejected request is **not** counted. Otherwise a client hammering the
 * endpoint would keep pushing their own reset further out and never recover,
 * which turns a rate limit into a ban — and makes `Retry-After` a lie.
 */
export function consume(key: string, tier: RateTier): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const namespaced = `${tier.name}:${key}`;
  let bucket = buckets.get(namespaced);

  if (!bucket) {
    bucket = { counts: tier.windows.map(() => 0), resets: tier.windows.map(() => 0) };
    buckets.set(namespaced, bucket);
  }

  // Roll over any window whose period has elapsed.
  for (let i = 0; i < tier.windows.length; i++) {
    if (bucket.resets[i] <= now) {
      bucket.counts[i] = 0;
      bucket.resets[i] = now + tier.windows[i].windowMs;
    }
  }

  // Report against whichever window has the least headroom, so `remaining`
  // answers "how many more may I send" rather than "how many of one budget".
  let tightest = 0;
  let blocked = -1;
  for (let i = 0; i < tier.windows.length; i++) {
    const headroom = tier.windows[i].limit - bucket.counts[i];
    if (headroom <= 0 && blocked === -1) blocked = i;
    if (headroom < tier.windows[tightest].limit - bucket.counts[tightest]) tightest = i;
  }

  if (blocked !== -1) {
    return {
      ok: false,
      limit: tier.windows[blocked].limit,
      remaining: 0,
      // Rounded up, and never 0: a `Retry-After: 0` invites an immediate retry
      // that is certain to be rejected again.
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resets[blocked] - now) / SECOND)),
    };
  }

  for (let i = 0; i < tier.windows.length; i++) bucket.counts[i] += 1;

  return {
    ok: true,
    limit: tier.windows[tightest].limit,
    remaining: Math.max(0, tier.windows[tightest].limit - bucket.counts[tightest]),
    retryAfterSeconds: 0,
  };
}

/**
 * Gives back one request charged to `key`.
 *
 * For the case where the budget exists to meter *failures* — a successful
 * sign-in is not an attack, and a household or an office behind one address
 * should not run itself out of logins by signing in. Floors at zero, so a
 * refund for a request that was never charged is a no-op rather than a credit.
 */
export function release(key: string, tier: RateTier): void {
  const bucket = buckets.get(`${tier.name}:${key}`);
  if (!bucket) return;
  for (let i = 0; i < bucket.counts.length; i++) {
    bucket.counts[i] = Math.max(0, bucket.counts[i] - 1);
  }
}

/* -------------------------------------------------------------------------- */
/* Applying it                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The whole check for a route: identify the caller, count the request.
 *
 * Returns the result rather than a response, because what a rejection *means*
 * differs by route — a 429 on a write, a silent degrade on anything assistive —
 * and only the route knows which.
 */
export function checkRateLimit(
  req: NextRequest,
  tier: RateTier,
  session?: SessionUser | null
): RateLimitResult {
  return consume(callerKey(req, session), tier);
}

/**
 * The 429.
 *
 * The body is a fixed sentence in the same `{ error }` shape every other route
 * uses. It names no account, no endpoint budget and no reason beyond the rate:
 * a limiter that says "too many attempts for this email" is an account
 * enumeration oracle, and one that reports which tier it belongs to maps the
 * API for whoever is probing it.
 *
 * `Retry-After` is the one detail worth telling a caller, because it is the
 * only one that lets a well-behaved client back off correctly. The
 * `X-RateLimit-*` headers are the caller's own standing and are therefore not a
 * leak — they describe the key the request already proved it holds.
 */
export function rateLimited(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        // Nothing here should ever be cached and replayed to another caller.
        'Cache-Control': 'no-store',
      },
    }
  );
}
