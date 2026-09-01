/**
 * dxWorld.js — DX-World RSS source fetcher for the DX news multi-source aggregator.
 *
 * Fetches https://www.dx-world.net/feed/ using rss-parser@3.13.0 and returns
 * normalized merged-feed items with callsigns extracted from titles.
 *
 * DX-World title convention: "CALLSIGN – Location" (callsign at position 0,
 * en-dash separator) — makes callsign extraction trivial and reliable.
 *
 * Implements CONTEXT.md decisions:
 *   D-04 — 24h freshness cutoff (applied by mergeNews, not this fetcher)
 *   D-08 — callsign extracted from title-first (RESEARCH Pitfall 2)
 *   D-12 — sourceUrl = SOURCE_URLS['DX-WORLD']
 */

'use strict';

const Parser = require('rss-parser');
const { extractCallsign, SOURCE_URLS } = require('../../utils/dxNewsMerge.js');

const parser = new Parser();

// Fetch www directly (the apex 301s here). Cloudflare tarpits bare product
// User-Agents on this host — rss-parser's parseURL would hang until timeout —
// so we fetch ourselves with a Mozilla-compatible UA and hand the XML to
// parseString.
const DX_WORLD_FEED_URL = 'https://www.dx-world.net/feed/';
const DX_WORLD_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OpenHamClock/26.6; +https://openhamclock.com)',
  Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
};

/**
 * Parse an rss-parser feed object into normalized merged-feed items.
 * Pure function — no HTTP, no side effects.
 *
 * @param {object|null} feed — the parsed feed object from rss-parser.parseURL/parseString
 * @returns {Array<object>} Normalized items in merged-feed item shape
 */
function parseDxWorldFeed(feed) {
  if (!feed || !Array.isArray(feed.items)) return [];

  const items = [];
  for (const raw of feed.items) {
    // Skip items with unparseable pubDate — cannot freshness-check without a date
    const dt = new Date(raw.pubDate);
    if (isNaN(dt.getTime())) continue;

    items.push({
      id: `dxworld:${raw.guid || raw.link}`,
      title: raw.title || '',
      // Prefer plain-text snippet; fall back to HTML content with tags stripped
      description: (raw.contentSnippet || raw.content || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
      url: raw.link,
      publishDate: dt.toISOString(),
      // Title-first extraction per RESEARCH Pitfall 2 (highest signal — callsign at pos 0)
      callsign: extractCallsign(raw.title),
      source: 'DX-WORLD',
      sourceUrl: SOURCE_URLS['DX-WORLD'],
    });
  }

  return items;
}

/**
 * Fetch the DX-World RSS feed and return normalized items.
 *
 * @param {object} [ctx] — server context object (unused for DX-World, included for API symmetry)
 * @returns {Promise<{ items: Array<object> }>}
 */
async function fetchFeedXml(url, headers) {
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DX-World feed HTTP ${res.status}`);
  return res.text();
}

async function fetchDxWorld(ctx) {
  // DX-World's Cloudflare blocks datacenter egress IPs (Railway) outright, so
  // hosted deployments set DXWORLD_PROXY_URL to the dx-relay Cloudflare Worker
  // (see dx-relay/). Direct fetch remains the default and the fallback.
  const proxyUrl = process.env.DXWORLD_PROXY_URL;
  let xml;
  if (proxyUrl) {
    try {
      const headers = {};
      if (process.env.DXWORLD_PROXY_KEY) headers['x-relay-key'] = process.env.DXWORLD_PROXY_KEY;
      xml = await fetchFeedXml(proxyUrl, headers);
    } catch (err) {
      xml = await fetchFeedXml(DX_WORLD_FEED_URL, DX_WORLD_FETCH_HEADERS);
    }
  } else {
    xml = await fetchFeedXml(DX_WORLD_FEED_URL, DX_WORLD_FETCH_HEADERS);
  }
  const feed = await parser.parseString(xml);
  return { items: parseDxWorldFeed(feed) };
}

module.exports = { fetchDxWorld, parseDxWorldFeed };
