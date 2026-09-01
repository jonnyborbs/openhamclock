# dx-relay

Tiny Cloudflare Worker that relays the DX-World RSS feed for hosted
OpenHamClock deployments. DX-World's Cloudflare protection blocks fetches
from datacenter IP ranges (Railway), so the server can set
`DXWORLD_PROXY_URL` to this worker's `/dxworld-feed` endpoint instead.
Self-hosted installs on residential connections don't need it.

**Not an open proxy** — only the hardcoded upstream paths are served,
responses are edge-cached 10 minutes, and an optional `RELAY_KEY` secret
locks it to your servers.

## Deploy

```bash
cd dx-relay
npx wrangler login        # once, interactive
npx wrangler deploy
npx wrangler secret put RELAY_KEY   # optional but recommended
```

Then on the Railway service(s):

- `DXWORLD_PROXY_URL=https://dx-relay.<your-subdomain>.workers.dev/dxworld-feed`
- `DXWORLD_PROXY_KEY=<the RELAY_KEY value>` (if you set one)

The server prefers the relay and silently falls back to a direct fetch if
the relay errors. Verify after deploy:

```bash
curl -s https://dx-relay.<subdomain>.workers.dev/health
curl -s <staging>/api/dxnews | grep -c DX-WORLD
```
