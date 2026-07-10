---
created: 2026-06-05T16:08:48.771Z
title: Flip watchtower openhamclock probe back to prod URL
area: infrastructure
files:
  - watchtower/src/index.js:28-35
---

## Problem

The watchtower Cloudflare Worker is currently probing
`https://openhamclock-staging.up.railway.app/api/health` instead of the
production URL. Staging was chosen as a stopgap so the worker could see
the new Phase A `subsystems` block (fletcher, rbn, satellites, propagation)
plus the rate-limit skip on `/api/health` — both of which only exist on
Staging right now.

Production-side blockers that need to ship first:

- `b4c6042` — feat(health): expand /api/health with subsystem snapshot
- `2683ca3` — fix(health): read TLE_FETCHER_URL env var directly so
  fletcher probe works pre-#1063
- `d93bbcf` — fix(rate-limit): skip /api/health so external uptime
  monitors don't 429

Until those land in prod, the watchtower is technically monitoring
Staging uptime, not Production uptime, which is the wrong signal for a
prod alerting tool.

## Solution

After the next Staging → main release that carries those three commits:

1. Edit `watchtower/src/index.js` around line 28-35. The SERVICES entry
   for `openhamclock` has a marker comment ("Probe Staging for now...")
   that calls this out.
2. Change `url` from
   `https://openhamclock-staging.up.railway.app/api/health` to
   `https://openhamclock.up.railway.app/api/health` (Railway-direct, not
   the CF-fronted openhamclock.com which 429s our worker via Bot Fight).
3. Remove the marker comment.
4. `cd watchtower && npx wrangler deploy`.
5. Hit `https://watchtower.chris-188.workers.dev/tick` to verify
   `openhamclock.aggregate` returns `ok` with `version`/`uptime` detail
   and `subsystems` populated.

Optional follow-up: add `https://openhamclock.com/api/health` as a
second `openhamclock-cf` probe if we want explicit CF-reachability
alerting. Would require either a CF firewall rule allowing the
watchtower User-Agent, or a CF Worker Service Binding on the same
account so the fetch bypasses Bot Fight.
