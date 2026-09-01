/**
 * SeasonalEffects — ambient weather for the four season themes, in the same
 * mold as MatrixRain: one full-viewport 2D canvas above the UI, throttled
 * rAF, mounted by App only while a season theme is active, skipped under
 * Low Memory Mode (App-side) and prefers-reduced-motion (here).
 *
 *   winter → drifting snow          spring → falling blossom petals
 *   summer → wandering fireflies    fall   → tumbling leaves
 *
 * Each season also hides a date-triggered easter egg (utils/seasonalEggs):
 * Christmas presents and New Year sparks in the snow, Easter eggs among the
 * petals, fireflies that blink "73" in Morse on Field Day weekend and go
 * red/white/blue on July 4, bats and jack-o'-lanterns in the Halloween
 * leaves. Egg state re-checks hourly so a wall display that runs for weeks
 * wakes up decorated on the right morning.
 */
import { useEffect, useRef } from 'react';
import { activeEggForDate, eggOverride } from '../utils/seasonalEggs.js';

const FRAME_MS = 50; // ~20 fps — smooth enough for drift, kind to Pis
const EGG_RECHECK_MS = 60 * 60 * 1000;

const PETAL_COLORS = ['#ffc0cb', '#ffb7c5', '#ff9eb5', '#ffd9e0'];
const LEAF_GLYPHS = ['🍁', '🍂', '🍁', '🍂', '🍃'];

// "73" in Morse (--... ...--) as on/off duration units; dot=1, dash=3,
// intra-element gap=1, inter-digit gap=3, then a long rest before repeating.
const MORSE_73 = [
  [3, 1],
  [3, 1],
  [1, 1],
  [1, 1],
  [1, 3], // 7: --...
  [1, 1],
  [1, 1],
  [1, 1],
  [3, 1],
  [3, 14], // 3: ...--
].flatMap(([on, off]) => [
  { lit: true, units: on },
  { lit: false, units: off },
]);
const MORSE_UNIT_MS = 160;
const MORSE_TOTAL_UNITS = MORSE_73.reduce((sum, s) => sum + s.units, 0);

// Fraction of falling particles that render as the egg glyph instead
const EGG_GLYPHS = {
  christmas: { glyphs: ['🎁', '🎄', '⭐'], share: 0.08 },
  newyear: { glyphs: ['✨', '🎉'], share: 0.08 },
  easter: { glyphs: ['🥚', '🐣', '🐰'], share: 0.1 },
  halloween: { glyphs: ['🎃', '🦇', '👻'], share: 0.12 },
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function makeFaller(season, width, height, egg, fromTop) {
  const p = {
    x: rand(0, width),
    y: fromTop ? -rand(10, 40) : rand(0, height),
    phase: rand(0, Math.PI * 2),
    glyph: null,
  };
  const eggDef = EGG_GLYPHS[egg];
  if (eggDef && Math.random() < eggDef.share) p.glyph = pick(eggDef.glyphs);

  if (season === 'winter') {
    p.r = rand(1, 3);
    p.vy = 0.3 + p.r * 0.3;
    p.sway = rand(0.2, 0.6);
    p.size = 14;
  } else if (season === 'spring') {
    p.size = rand(4, 7);
    p.vy = rand(0.3, 0.8);
    p.sway = rand(0.6, 1.4);
    p.rot = rand(0, Math.PI * 2);
    p.vrot = rand(-0.03, 0.03);
    p.color = pick(PETAL_COLORS);
  } else {
    // fall leaves
    p.size = rand(12, 18);
    p.vy = rand(0.5, 1.1);
    p.sway = rand(0.8, 1.8);
    p.rot = rand(0, Math.PI * 2);
    p.vrot = rand(-0.04, 0.04);
    if (!p.glyph) p.glyph = pick(LEAF_GLYPHS);
  }
  return p;
}

function makeFirefly(width, height, index) {
  return {
    x: rand(0, width),
    y: rand(height * 0.25, height),
    angle: rand(0, Math.PI * 2),
    speed: rand(0.15, 0.4),
    phase: rand(0, Math.PI * 2),
    pulse: rand(0.05, 0.12), // radians per frame — a lazy 2-6s glow cycle
    index,
  };
}

const SEASON_STYLE = {
  winter: { opacity: 0.55, density: 14 },
  spring: { opacity: 0.5, density: 26 },
  summer: { opacity: 0.7, density: 44 },
  fall: { opacity: 0.5, density: 30 },
};

export const SeasonalEffects = ({ season }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const { density } = SEASON_STYLE[season] || SEASON_STYLE.winter;

    // ?egg=christmas|newyear|easter|fieldday|july4|halloween previews an
    // egg without waiting for its date (pinned — the hourly re-check skips)
    const override = eggOverride(window.location.search);
    let egg = override ?? activeEggForDate(season);
    let particles = [];
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = Math.max(12, Math.round(canvas.width / density));
      particles =
        season === 'summer'
          ? Array.from({ length: Math.min(count, 40) }, (_, i) => makeFirefly(canvas.width, canvas.height, i))
          : Array.from({ length: count }, () => makeFaller(season, canvas.width, canvas.height, egg, false));
    };
    resize();
    window.addEventListener('resize', resize);

    // Wall displays run for weeks — re-check the calendar hourly so the egg
    // appears/disappears at (roughly) midnight. Fallers rebuild so the egg
    // shows immediately; fireflies read `egg` live each frame anyway.
    const eggTimer = setInterval(() => {
      if (override) return;
      const next = activeEggForDate(season);
      if (next !== egg) {
        egg = next;
        if (season !== 'summer') resize();
      }
    }, EGG_RECHECK_MS);

    let raf = 0;
    let last = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (season === 'summer') {
        // Morse timeline position for the Field Day fireflies
        let morseLit = false;
        if (egg === 'fieldday') {
          let unit = (now / MORSE_UNIT_MS) % MORSE_TOTAL_UNITS;
          for (const seg of MORSE_73) {
            if (unit < seg.units) {
              morseLit = seg.lit;
              break;
            }
            unit -= seg.units;
          }
        }
        for (const p of particles) {
          p.angle += rand(-0.15, 0.15);
          p.x += Math.cos(p.angle) * p.speed;
          p.y += Math.sin(p.angle) * p.speed * 0.6;
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          if (p.y < h * 0.15) p.y = h * 0.15;
          if (p.y > h + 10) p.y = h * 0.3;
          p.phase += p.pulse;

          const isMorse = egg === 'fieldday' && p.index < 3;
          const glow = isMorse ? (morseLit ? 1 : 0.04) : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(p.phase));
          let color = '255, 224, 102'; // warm firefly yellow
          // July 4: stable per-firefly red/white/blue, keyed by index so it
          // doesn't strobe a new color every frame
          if (egg === 'july4') color = ['224, 60, 60', '245, 245, 245', '80, 120, 255'][p.index % 3];
          ctx.fillStyle = `rgba(${color}, ${(glow * 0.25).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${color}, ${glow.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.phase += 0.06;
          p.y += p.vy;
          p.x += Math.sin(p.phase) * p.sway;
          if (p.rot !== undefined) p.rot += p.vrot;
          if (p.y > h + 24 || p.x < -30 || p.x > w + 30) {
            particles[i] = makeFaller(season, w, h, egg, true);
            continue;
          }

          if (p.glyph) {
            ctx.save();
            ctx.translate(p.x, p.y);
            if (p.rot !== undefined) ctx.rotate(p.rot);
            ctx.font = `${p.size}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.glyph, 0, 0);
            ctx.restore();
          } else if (season === 'winter') {
            ctx.fillStyle = 'rgba(234, 246, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // spring petal: rotated ellipse
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(eggTimer);
      window.removeEventListener('resize', resize);
    };
  }, [season]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 6, // matches MatrixRain: above layout and the map, below sidebar and modals
        opacity: (SEASON_STYLE[season] || SEASON_STYLE.winter).opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

export default SeasonalEffects;
