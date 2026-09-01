/**
 * Guard test: every help deep-link anchor must point at a real heading
 * in docs/MANUAL.md. If a manual edit renames or removes a section,
 * this test fails instead of the in-app help links silently breaking.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HELP_TOPICS,
  PANEL_HELP,
  LAYER_HELP,
  SETTINGS_TAB_HELP,
  topicAnchor,
  panelHelpTopic,
  layerHelpTopic,
} from './helpTopics.js';
import { extractHeadings } from '../components/MarkdownView.jsx';

// vitest runs with the project root as cwd (jsdom import.meta.url is not file:)
const manual = readFileSync(resolve(process.cwd(), 'docs/MANUAL.md'), 'utf8');
const headingIds = new Set(extractHeadings(manual).map((h) => h.id));

describe('helpTopics anchors vs docs/MANUAL.md', () => {
  it('found a sensible number of headings in the manual', () => {
    expect(headingIds.size).toBeGreaterThan(20);
  });

  it('parses a CRLF manual identically (Windows checkouts)', () => {
    // core.autocrlf=true converts the manual to \r\n on disk; heading
    // extraction must not miss every heading there (it once did — `.`
    // never matches \r, so `^#+ (.*)$` failed on each line).
    const crlfIds = new Set(extractHeadings(manual.replace(/\n/g, '\r\n')).map((h) => h.id));
    expect(crlfIds).toEqual(headingIds);
  });

  it('every HELP_TOPICS anchor exists as a manual heading', () => {
    for (const [topic, anchor] of Object.entries(HELP_TOPICS)) {
      expect(
        headingIds.has(anchor),
        `HELP_TOPICS['${topic}'] → '#${anchor}' has no matching heading in MANUAL.md`,
      ).toBe(true);
    }
  });

  it('every PANEL_HELP value is a known topic key', () => {
    for (const [panel, topic] of Object.entries(PANEL_HELP)) {
      expect(HELP_TOPICS[topic], `PANEL_HELP['${panel}'] → unknown topic '${topic}'`).toBeDefined();
    }
  });

  it('every LAYER_HELP value is a known topic key', () => {
    for (const [layer, topic] of Object.entries(LAYER_HELP)) {
      expect(HELP_TOPICS[topic], `LAYER_HELP['${layer}'] → unknown topic '${topic}'`).toBeDefined();
    }
  });

  it('every SETTINGS_TAB_HELP value is a known topic key', () => {
    for (const [tab, topic] of Object.entries(SETTINGS_TAB_HELP)) {
      expect(HELP_TOPICS[topic], `SETTINGS_TAB_HELP['${tab}'] → unknown topic '${topic}'`).toBeDefined();
    }
  });

  it('fallbacks resolve to real anchors for unknown ids', () => {
    expect(headingIds.has(topicAnchor('nonsense-topic'))).toBe(true);
    expect(headingIds.has(topicAnchor(panelHelpTopic('unknown-panel')))).toBe(true);
    expect(headingIds.has(topicAnchor(layerHelpTopic('unknown-layer')))).toBe(true);
  });

  it("the manual's own internal #anchor links all resolve (renderer slugs match the TOC)", () => {
    // Strip code fences, then collect [text](#anchor) links
    const noFences = manual.replace(/```[\s\S]*?```/g, '');
    const anchors = [...noFences.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(10);
    for (const a of anchors) {
      expect(headingIds.has(a), `MANUAL.md internal link '#${a}' has no matching heading slug`).toBe(true);
    }
  });
});
