/**
 * MatrixRain — the movie treatment for the Matrix theme: half-width
 * katakana (plus digits) falling in phosphor-green columns behind the
 * whole UI. Mounted by App only while the Matrix theme is active, and
 * skipped entirely under Low Memory Mode or prefers-reduced-motion.
 *
 * Deliberately cheap: one full-viewport 2D canvas, ~14 fps via a
 * timestamp-throttled rAF, and the classic trail-fade algorithm (a
 * translucent black fill per frame) so nothing is ever cleared or
 * re-laid-out. Panels are translucent glass in this theme (main.css),
 * so the rain reads through them without touching their content.
 */
import { useEffect, useRef } from 'react';

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z';
const FONT_PX = 16;
const FRAME_MS = 70; // ~14 fps — plenty for rain, kind to Pis
// Faint overlay ABOVE the UI: at z-index 0 behind the app, every opaque
// layout container and the map painted over the rain and nobody ever saw it.
// Low opacity keeps text readable while the code rain falls over the HUD.
const OPACITY = 0.14;

export const MatrixRain = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    let columns = 0;
    let drops = [];
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.ceil(canvas.width / FONT_PX);
      drops = Array.from({ length: columns }, () => Math.floor(Math.random() * (canvas.height / FONT_PX)));
      ctx.fillStyle = '#010401';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;

      // Trail fade
      ctx.fillStyle = 'rgba(1, 4, 1, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${FONT_PX}px monospace`;
      for (let i = 0; i < columns; i++) {
        const char = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * FONT_PX;
        const y = drops[i] * FONT_PX;
        // Head glyph bright, body handled by the fade
        ctx.fillStyle = Math.random() < 0.1 ? '#d8ffe0' : '#00ff41';
        ctx.fillText(char, x, y);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        else drops[i]++;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 6, // above layout containers and the map, below the sidebar (9999) and modals
        opacity: OPACITY,
        pointerEvents: 'none',
      }}
    />
  );
};

export default MatrixRain;
