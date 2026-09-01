'use strict';

/**
 * CelesTrak failure policy (#1165).
 *
 * The satellite state machine sets each satellite's backoffCelestrakUntil
 * optimistically BEFORE a fetch is attempted. When the fetch then fails,
 * leaving that 2-hour backoff in place means a single boot-time timeout or
 * rate-limit costs the whole group the full window — the release-day
 * "25/40 sats for two hours" incident. This module decides, per HTTP
 * outcome, whether the global CelesTrak block should engage (and for how
 * long) and whether the just-marked satellites should have their per-sat
 * backoff rolled back to a short retry.
 *
 * Layering: the global block is source-level politeness toward CelesTrak;
 * the per-sat backoff exists so a satellite they don't track (404) isn't
 * re-queried all day. A transient failure deserves neither penalty in full.
 */

const BOOT_GRACE_MS = 15 * 60 * 1000; // window after boot where a rate-limit is likely the co-deploy race
const BOOT_BLOCK_MS = 10 * 60 * 1000; // first rate-limit inside that window: short block
const BAN_BLOCK_MS = 120 * 60 * 1000; // rate-limit in steady state: assume a real ban

/**
 * @param {number} httpStatusCode  0 = no response (timeout / network error)
 * @param {number} msSinceBoot     process uptime when the failure was observed
 * @returns {{ blockMs: number, rollbackSats: boolean }}
 *   blockMs      duration for the global CelesTrak block (0 = none)
 *   rollbackSats true when the optimistic per-sat 2h backoff should be
 *                shortened so the next state-machine pass can retry soon
 */
function celestrakFailurePolicy(httpStatusCode, msSinceBoot) {
  if (httpStatusCode >= 200 && httpStatusCode < 300) {
    return { blockMs: 0, rollbackSats: false };
  }

  const rateLimited = httpStatusCode === 301 || httpStatusCode === 403 || httpStatusCode === 429;
  if (rateLimited) {
    return {
      blockMs: msSinceBoot < BOOT_GRACE_MS ? BOOT_BLOCK_MS : BAN_BLOCK_MS,
      rollbackSats: true,
    };
  }

  if (httpStatusCode === 404) {
    // Satellite/group genuinely absent upstream — keep the long per-sat
    // backoff so we don't re-ask for it every cycle.
    return { blockMs: 0, rollbackSats: false };
  }

  // status 0 (timeout / cold fletcher) or 5xx: transient, retry soon.
  return { blockMs: 0, rollbackSats: true };
}

module.exports = { celestrakFailurePolicy, BOOT_GRACE_MS, BOOT_BLOCK_MS, BAN_BLOCK_MS };
