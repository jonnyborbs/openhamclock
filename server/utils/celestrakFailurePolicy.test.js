import { describe, expect, it } from 'vitest';
import policy from './celestrakFailurePolicy.js';

const { celestrakFailurePolicy, BOOT_GRACE_MS, BOOT_BLOCK_MS, BAN_BLOCK_MS } = policy;

const ONE_HOUR = 60 * 60 * 1000;

describe('celestrakFailurePolicy', () => {
  it('does nothing on success', () => {
    expect(celestrakFailurePolicy(200, ONE_HOUR)).toEqual({ blockMs: 0, rollbackSats: false });
  });

  it('rolls back per-sat backoff on timeout (status 0) without a global block', () => {
    expect(celestrakFailurePolicy(0, ONE_HOUR)).toEqual({ blockMs: 0, rollbackSats: true });
  });

  it('rolls back per-sat backoff on 5xx without a global block', () => {
    expect(celestrakFailurePolicy(502, ONE_HOUR)).toEqual({ blockMs: 0, rollbackSats: true });
  });

  it('keeps the long per-sat backoff on 404 (satellite absent upstream)', () => {
    expect(celestrakFailurePolicy(404, ONE_HOUR)).toEqual({ blockMs: 0, rollbackSats: false });
  });

  it('uses the short block for a rate-limit inside the boot grace window', () => {
    for (const status of [301, 403, 429]) {
      expect(celestrakFailurePolicy(status, BOOT_GRACE_MS - 1)).toEqual({
        blockMs: BOOT_BLOCK_MS,
        rollbackSats: true,
      });
    }
  });

  it('uses the full 120-min block for a rate-limit in steady state', () => {
    for (const status of [301, 403, 429]) {
      expect(celestrakFailurePolicy(status, BOOT_GRACE_MS)).toEqual({
        blockMs: BAN_BLOCK_MS,
        rollbackSats: true,
      });
    }
  });
});
