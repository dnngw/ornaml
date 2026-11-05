"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Which pane small screens show ("pdf" | "chat"), plus the "new answer" dot.
 * A ref mirrors the view so a streaming answer that finishes after the user
 * switched panes still sees the current view.
 */
export function useMobileView() {
  const [view, setViewState] = useState("chat");
  const [badge, setBadge] = useState(false);
  const viewRef = useRef("chat");

  const setView = useCallback((v) => {
    viewRef.current = v;
    setViewState(v);
    if (v === "chat") setBadge(false);
  }, []);

  const noteFreshAnswer = useCallback(() => {
    if (viewRef.current === "pdf") setBadge(true);
  }, []);

  return { view, setView, badge, noteFreshAnswer };
}
