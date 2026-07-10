/**
 * usePopupPosition — calculates a popup's position relative to an anchor element.
 *
 * Returns an inline style object with top/left positioning and a className
 * indicating whether the popup is above or below the anchor.
 *
 * The popup is positioned below the anchor by default. If there isn't enough
 * space below (viewport boundary), it flips above. It also handles right-edge
 * overflow.
 *
 * Usage:
 *   const pos = usePopupPosition(anchorEl, popupWidth);
 *   // anchorEl can be a ref object ({ current: DOMElement }) or a direct DOM element
 *   <div style={{ position: 'fixed', ...pos.style, ... }} className={pos.className}>
 *     ...
 *   </div>
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Popup height estimate — initial estimate before ResizeObserver measures actual height
// (header-only before API data resolves, ~60px; with body ~160px)
export const POPUP_HEIGHT_ESTIMATE = 120;

// Minimum padding from viewport edges
const MARGIN = 8;
// Extra padding from right edge to avoid clipping
const RIGHT_MARGIN = 16;

export default function usePopupPosition(anchorEl, popupHeightRef, popupWidth = 260, onRecalculate = null) {
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    className: '',
  });
  const rafRef = useRef(null);

  // Resolve anchor: accepts a ref object ({ current }) or a direct DOM element
  const getAnchor = useCallback(() => {
    if (!anchorEl) return null;
    // If it's a ref object, use .current; otherwise it's already the element
    return typeof anchorEl === 'object' && 'current' in anchorEl ? anchorEl.current : anchorEl;
  }, [anchorEl]);

  const recalculate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const anchor = getAnchor();
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const popupH = popupHeightRef?.current ?? POPUP_HEIGHT_ESTIMATE;
      const availBelow = window.innerHeight - rect.bottom - MARGIN;
      const availAbove = rect.top - MARGIN;

      let top;
      let cls = 'above';

      if (availAbove >= popupH * 0.6 || availAbove > availBelow) {
        // Position above anchor
        top = rect.top - MARGIN - popupH;
        cls = 'above';
      } else {
        // Position below anchor
        top = rect.bottom + MARGIN;
        cls = 'below';
      }

      // Horizontal: align left edge with anchor's left edge
      let left = rect.left;
      const popupRight = left + popupWidth;
      if (popupRight > window.innerWidth - RIGHT_MARGIN) {
        // Shift left to stay in viewport
        left = window.innerWidth - popupWidth - RIGHT_MARGIN;
      }
      // Ensure left edge doesn't go off-screen
      if (left < MARGIN) left = MARGIN;

      setPosition({ top, left, className: cls });
    });
  }, [getAnchor, popupHeightRef, popupWidth]);

  // Expose recalculate function to caller (popup component)
  useEffect(() => {
    if (onRecalculate) onRecalculate(recalculate);
  }, [recalculate, onRecalculate]);

  useEffect(() => {
    recalculate();
    const onResize = () => recalculate();
    const onScroll = () => recalculate();

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });

    // Observe DOM changes that might shift the anchor
    const observer = new ResizeObserver(recalculate);
    const resolved = getAnchor();
    if (resolved) observer.observe(resolved);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [recalculate]);

  return position;
}
