"use client";

import { useRef, useState } from "react";

/**
 * PDF on the left, chat on the right, with a draggable divider.
 * Below the md breakpoint (768px) only one pane shows at a time, with a
 * PDF / Chat switch on top. Both panes stay mounted, so switching keeps the
 * reading position and the chat state.
 *
 * @param view          "pdf" | "chat": which pane small screens show
 * @param onViewChange  called with the pane the user switches to
 * @param chatBadge     dot on the Chat switch (e.g. a new answer arrived while reading)
 */
export default function SplitView({ left, right, initial = 56, view = "chat", onViewChange, chatBadge = false }) {
  const [split, setSplit] = useState(initial); // left pane width in % (wide screens)
  const rootRef = useRef(null);

  function startDrag(e) {
    e.preventDefault();
    const rect = rootRef.current.getBoundingClientRect();
    const move = (ev) => setSplit(Math.min(75, Math.max(30, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const switchButton = (target, label, badge) => (
    <button
      type="button"
      aria-pressed={view === target}
      onClick={() => onViewChange?.(target)}
      className={`nb-btn nb-btn-sm relative flex-1 ${view === target ? "nb-btn-primary" : ""}`}
    >
      {label}
      {badge && (
        <span
          className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-[1.5px] border-ink bg-cite"
          title="New answer"
        />
      )}
    </button>
  );

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex shrink-0 gap-2 border-b-2 border-ink bg-white p-2 md:hidden" aria-label="Switch view">
        {switchButton("pdf", "📄 PDF", false)}
        {switchButton("chat", "💬 Chat", chatBadge && view !== "chat")}
      </div>

      <section
        style={{ "--split": `${split}%` }}
        className={`${view === "pdf" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-neutral-200 md:flex md:w-[var(--split)] md:flex-none`}
      >
        {left}
      </section>
      <div
        onPointerDown={startDrag}
        className="hidden w-0.75 shrink-0 cursor-col-resize bg-ink transition-colors hover:bg-accent md:block"
        title="Drag to resize"
      />
      <section
        className={`${view === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-white md:flex md:min-w-[320px]`}
      >
        {right}
      </section>
    </div>
  );
}
