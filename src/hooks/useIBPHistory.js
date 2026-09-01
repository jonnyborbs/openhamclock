/**
 * useIBPHistory — session-local listening-log accumulator for IBP beacons
 *
 * Folds successive RBN snapshots (from useIBPRBN) into a bounded per-cycle
 * history so IBPPanel's timeline view can show which beacons were heard over
 * the last HISTORY_MAX_CYCLES 3-minute cycles.  Client-side only; the log
 * starts empty each session and grows one column per cycle.
 *
 * Returns Array<{ cycleStartMs, heard: Map<callsign, { maxSNR, count }> }>,
 * oldest → newest (the newest entry is always the current cycle).
 */
import { useState, useEffect } from 'react';
import { getCycleStartMs, updateHeardHistory } from '../utils/ibp.js';

/** How often to check for a cycle rollover (ms). */
const ROLLOVER_CHECK_MS = 5_000;

/**
 * @param {Map<string, { maxSNR: number|null, count: number }>} rbnData
 *   Current RBN snapshot from useIBPRBN.
 */
export function useIBPHistory(rbnData) {
  const [history, setHistory] = useState([]);

  // Merge every new RBN snapshot into the current cycle's record.
  useEffect(() => {
    setHistory((h) => updateHeardHistory(h, getCycleStartMs(new Date()), rbnData));
  }, [rbnData]);

  // Advance the timeline on cycle rollover even when no new RBN data arrives
  // (updateHeardHistory returns the same reference when nothing changed, so
  // this is a no-op re-render most of the time).
  useEffect(() => {
    const id = setInterval(() => {
      setHistory((h) => updateHeardHistory(h, getCycleStartMs(new Date()), new Map()));
    }, ROLLOVER_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  return history;
}

export default useIBPHistory;
