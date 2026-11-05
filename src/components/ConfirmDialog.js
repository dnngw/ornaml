"use client";

import { useEffect, useRef } from "react";

/**
 * Neo-brutalist confirmation modal.
 * Closes on Escape or backdrop click (unless busy). Focus starts on Cancel,
 * so a stray Enter never confirms a destructive action.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px] animate-[nb-fade_120ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="nb-card w-full max-w-md p-6 animate-[nb-pop_160ms_ease-out]"
      >
        <div className="flex items-start gap-4">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border-2 border-ink font-display text-xl font-bold shadow-[2px_2px_0_var(--ink)] ${
              danger ? "bg-red-500 text-white" : "bg-accent text-white"
            }`}
            aria-hidden
          >
            !
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-display text-xl font-bold">
              {title}
            </h2>
            <div className="mt-2 text-sm text-stone-700">{children}</div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} onClick={onCancel} disabled={busy} className="nb-btn">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`nb-btn ${danger ? "nb-btn-destructive" : "nb-btn-primary"}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
