"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

// Copied into /public by scripts/copy-pdf-worker.mjs
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const GAP = 16;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * @param highlights  every citation of the focused answer: [{ n, page, rects, exact }]
 * @param focus       { key, n } the citation to emphasize and scroll to; a new key re-scrolls
 * @param getInitialScrollTop / onScrollTopChange  let a parent remember the reading position
 *                    (collections switch between papers)
 */
export default function PdfViewer({ url, highlights = [], focus, getInitialScrollTop, onScrollTopChange }) {
  const scrollRef = useRef(null);
  const pageRefs = useRef([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [ratios, setRatios] = useState(null); // height / width for each page
  const [visible, setVisible] = useState(() => new Set([1, 2]));
  const [current, setCurrent] = useState(1);
  const [loadError, setLoadError] = useState("");

  // Fit-to-width base size, tracked as the pane resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(200, Math.floor((containerWidth - GAP * 2) * zoom));

  const onLoad = useCallback(async (pdf) => {
    const sizes = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        pdf.getPage(i + 1).then((p) => {
          const v = p.getViewport({ scale: 1 });
          return v.height / v.width;
        }),
      ),
    );
    setRatios(sizes);
  }, []);

  // Only render pages near the viewport; others are sized placeholders.
  const laidOut = Boolean(ratios) && containerWidth > 0;
  useEffect(() => {
    if (!laidOut) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number(e.target.dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root: scrollRef.current, rootMargin: "150% 0px" },
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [laidOut, ratios]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    onScrollTopChange?.(el.scrollTop);
    const mid = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    pageRefs.current.forEach((p, i) => {
      if (p && p.offsetTop <= mid) page = i + 1;
    });
    setCurrent(page);
  }

  function goTo(page, yFraction = 0, smooth = true) {
    const el = pageRefs.current[page - 1];
    if (!el || !scrollRef.current) return;
    const top = el.offsetTop + yFraction * el.offsetHeight - 80;
    scrollRef.current.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }

  // Jump to the focused citation whenever the focus changes.
  const target = highlights.find((h) => h.n === focus?.n);

  // A hidden pane (small screens) has no width, so a jump made while hidden
  // lands wrong. Redo it once the pane shows up.
  const wasHidden = useRef(true);
  useEffect(() => {
    if (containerWidth === 0) {
      wasHidden.current = true;
      return;
    }
    if (!wasHidden.current) return;
    wasHidden.current = false;
    if (target && ratios) {
      const firstY = target.rects?.length ? Math.min(...target.rects.map((r) => r[1])) : 0;
      goTo(target.page, firstY, false);
    }
  }, [containerWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the remembered reading position once pages are laid out (unless a citation takes over).
  const restored = useRef(false);
  useEffect(() => {
    if (!laidOut || restored.current) return;
    restored.current = true;
    const top = getInitialScrollTop?.() ?? 0;
    if (!target && top > 0) scrollRef.current?.scrollTo({ top });
  }, [laidOut]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!target || !ratios) return;
    const firstY = target.rects?.length ? Math.min(...target.rects.map((r) => r[1])) : 0;
    goTo(target.page, firstY);
  }, [focus?.key, ratios]); // eslint-disable-line react-hooks/exhaustive-deps

  const numPages = ratios?.length ?? 0;
  const zoomIdx = ZOOMS.indexOf(zoom);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b-2 border-ink bg-white px-3 text-xs font-medium">
        <div className="flex items-center gap-1">
          <ToolButton disabled={current <= 1} onClick={() => goTo(current - 1)} title="Previous page">
            ↑
          </ToolButton>
          <ToolButton disabled={current >= numPages} onClick={() => goTo(current + 1)} title="Next page">
            ↓
          </ToolButton>
          <span className="ml-1.5 font-display font-bold tabular-nums">
            {numPages ? `Page ${current} / ${numPages}` : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ToolButton disabled={zoomIdx <= 0} onClick={() => setZoom(ZOOMS[zoomIdx - 1])} title="Zoom out">
            −
          </ToolButton>
          <button
            onClick={() => setZoom(1)}
            className="w-14 rounded py-1 font-display font-bold tabular-nums hover:bg-accent-soft"
            title="Fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton
            disabled={zoomIdx >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[zoomIdx + 1])}
            title="Zoom in"
          >
            +
          </ToolButton>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <p className="p-6 text-sm text-red-600">{loadError}</p>
        ) : (
          <Document
            file={url}
            // react-pdf 11 suspends by default; that would hide the whole viewer
            // (resetting scroll) each time a new page starts loading.
            suspense={false}
            onLoadSuccess={onLoad}
            onLoadError={(e) => setLoadError(`Could not load PDF: ${e.message}`)}
            loading={<p className="p-6 text-sm text-stone-400">Loading PDF…</p>}
            className="py-4"
          >
            {ratios &&
              containerWidth > 0 &&
              ratios.map((ratio, i) => {
                const n = i + 1;
                return (
                  <div
                    key={n}
                    data-page={n}
                    ref={(el) => (pageRefs.current[i] = el)}
                    className="relative mx-auto bg-white shadow-md"
                    style={{ width: pageWidth, height: Math.round(pageWidth * ratio), marginBottom: GAP }}
                  >
                    {visible.has(n) && (
                      <Page pageNumber={n} width={pageWidth} renderAnnotationLayer={false} loading={null} />
                    )}
                    {highlights
                      .filter((h) => h.page === n && h.rects?.length)
                      .map((h) => (
                        <CitationMarks key={`${focus?.key}-${h.n}`} h={h} active={h.n === focus?.n} />
                      ))}
                  </div>
                );
              })}
          </Document>
        )}
      </div>
    </div>
  );
}

/** Yellow boxes over the cited lines, plus a numbered tag in the margin. */
function CitationMarks({ h: raw, active }) {
  // Ignore implausible boxes (taller than ~3 lines), e.g. rotated margin text
  // in documents indexed before rotated text was filtered out.
  const h = { ...raw, rects: raw.rects.filter((r) => r[3] < 0.05) };
  if (!h.rects.length) return null;
  const top = Math.min(...h.rects.map((r) => r[1]));
  const left = Math.min(...h.rects.map((r) => r[0]));
  return (
    <>
      {h.rects.map((r, j) => (
        <div
          key={j}
          className={`pdf-highlight${active ? " is-active" : ""}`}
          style={{
            left: `calc(${r[0] * 100}% - 2px)`,
            top: `calc(${r[1] * 100}% - 1px)`,
            width: `calc(${r[2] * 100}% + 4px)`,
            height: `calc(${r[3] * 100}% + 2px)`,
          }}
        />
      ))}
      <span
        className={`pdf-cite-tag${active ? " is-active" : ""}`}
        style={{ left: `max(2px, calc(${left * 100}% - 24px))`, top: `calc(${top * 100}% - 1px)` }}
      >
        {h.label ?? h.n}
      </span>
    </>
  );
}

function ToolButton({ children, ...props }) {
  return (
    <button {...props} className="nb-icon-btn text-sm">
      {children}
    </button>
  );
}
