/**
 * solarCycle — pure chart geometry for the Solar Cycle panel.
 *
 * Turns the /api/solar-cycle payload (observed monthly SSN + SWPC cycle-25
 * predicted range) into inline-SVG path data: observed monthly line,
 * smoothed line, predicted min/max band, a "you are here" marker at the
 * latest observation, axis ticks. No chart library — same idiom as the
 * X-ray and sparkline charts.
 */

/** 'YYYY-MM' → months since year 0 (comparable integer), or null. */
export const monthNum = (t) => {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
};

const linePath = (pts) => (pts.length === 0 ? '' : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '));

/**
 * Build all chart geometry.
 *
 * @param {Array<{t:string, ssn:number|null, smoothed:number|null}>} observed
 * @param {Array<{t:string, min:number, max:number}>} predicted
 * @param {{width?:number, height?:number, padL?:number, padR?:number, padT?:number, padB?:number}} [opts]
 */
export const buildCycleChart = (observed = [], predicted = [], opts = {}) => {
  const { width = 300, height = 120, padL = 26, padR = 8, padT = 8, padB = 14 } = opts;

  const obs = observed.filter((d) => monthNum(d.t) != null);
  const pred = predicted.filter((d) => monthNum(d.t) != null);

  const allMonths = [...obs, ...pred].map((d) => monthNum(d.t));
  if (allMonths.length === 0) {
    return { empty: true, width, height };
  }
  const x0 = Math.min(...allMonths);
  const x1 = Math.max(...allMonths);
  const xSpan = Math.max(1, x1 - x0);

  const yValues = [
    ...obs.map((d) => d.ssn).filter((v) => Number.isFinite(v)),
    ...obs.map((d) => d.smoothed).filter((v) => Number.isFinite(v)),
    ...pred.map((d) => d.max).filter((v) => Number.isFinite(v)),
  ];
  const yMax = Math.max(10, ...yValues) * 1.05;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const x = (t) => padL + ((monthNum(t) - x0) / xSpan) * chartW;
  const y = (v) => padT + chartH - (Math.min(v, yMax) / yMax) * chartH;

  const ssnPts = obs.filter((d) => Number.isFinite(d.ssn)).map((d) => ({ x: x(d.t), y: y(d.ssn) }));
  const smoothedPts = obs.filter((d) => Number.isFinite(d.smoothed)).map((d) => ({ x: x(d.t), y: y(d.smoothed) }));

  // Predicted band: max edge forward, min edge reversed, closed.
  let bandPath = '';
  if (pred.length > 1) {
    const fwd = pred.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.t)},${y(d.max)}`).join(' ');
    const back = [...pred]
      .reverse()
      .map((d) => `L${x(d.t)},${y(d.min)}`)
      .join(' ');
    bandPath = `${fwd} ${back} Z`;
  }

  // "You are here": latest observation with a real SSN value.
  let marker = null;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (Number.isFinite(obs[i].ssn)) {
      marker = { x: x(obs[i].t), y: y(obs[i].ssn), t: obs[i].t, ssn: obs[i].ssn };
      break;
    }
  }

  // Peak observed SSN (for the max label).
  let peak = null;
  for (const d of obs) {
    if (Number.isFinite(d.ssn) && (!peak || d.ssn > peak.ssn)) {
      peak = { x: x(d.t), y: y(d.ssn), t: d.t, ssn: d.ssn };
    }
  }

  // X ticks: January of every Nth year, capped at ~8 ticks.
  const startYear = Math.ceil(x0 / 12);
  const endYear = Math.floor(x1 / 12);
  const yearStep = Math.max(1, Math.ceil((endYear - startYear + 1) / 8));
  const xTicks = [];
  for (let yr = startYear; yr <= endYear; yr += yearStep) {
    const t = `${String(yr).padStart(4, '0')}-01`;
    const mx = monthNum(t);
    if (mx >= x0 && mx <= x1) xTicks.push({ x: x(t), label: String(yr) });
  }

  // Y ticks: 0, half, max (rounded).
  const yTicks = [0, Math.round(yMax / 2), Math.round(yMax)].map((v) => ({ y: y(v), label: String(v) }));

  return {
    empty: false,
    width,
    height,
    padL,
    padT,
    chartW,
    chartH,
    yMax,
    ssnPath: linePath(ssnPts),
    smoothedPath: linePath(smoothedPts),
    bandPath,
    marker,
    peak,
    xTicks,
    yTicks,
  };
};

export default { monthNum, buildCycleChart };
