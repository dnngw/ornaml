"use client";

import { useEffect, useId, useRef, useState } from "react";

const MARGIN = 16; // keep this far from the screen edges
const MAX_WIDTH = 288;

/**
 * Small "i" next to a heading with a short explanation.
 * Shows on hover (desktop), keyboard focus, and tap/click (phones have no
 * hover). The bubble is only rendered while shown and is placed in the
 * viewport (fixed position, clamped to the screen), so it can never widen the
 * page on a phone. Tapping outside, scrolling or Escape closes it.
 */
export default function InfoTip({ label, children }) {
  const id = useId();
  const [pinned, setPinned] = useState(false); // opened by click/tap
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const shown = pinned || hovered || focused;

  // Called from event handlers (not effects), right before the bubble shows.
  const place = () => {
    const r = buttonRef.current.getBoundingClientRect();
    const width = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - MARGIN - width));
    setPos({ top: r.bottom + 8, left, width });
  };

  useEffect(() => {
    if (!shown) return;
    const close = () => {
      setPinned(false);
      setHovered(false);
      setFocused(false);
      buttonRef.current?.blur(); // a tapped button stays focused on phones
    };
    const outside = (e) => rootRef.current && !rootRef.current.contains(e.target) && close();
    const esc = (e) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [shown]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onMouseEnter={() => {
        place();
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={shown ? id : undefined}
        aria-expanded={shown}
        onClick={() => {
          place();
          setPinned((v) => !v);
        }}
        onFocus={() => {
          place();
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full border-2 border-ink bg-white font-display text-[11px] font-bold leading-none text-ink transition-colors hover:bg-accent-soft focus:bg-accent-soft focus:outline-none"
      >
        i
      </button>
      {shown && pos && (
        <span
          id={id}
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-50 rounded-md border-2 border-ink bg-white p-3 font-sans text-xs font-normal leading-relaxed text-stone-700 shadow-[3px_3px_0_var(--ink)] animate-[nb-fade_120ms_ease-out]"
        >
          {children}
        </span>
      )}
    </span>
  );
}
