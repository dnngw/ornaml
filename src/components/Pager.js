"use client";

/** Page numbers with gaps, e.g. [1, "…", 4, 5, 6, "…", 10]. */
function pageItems(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(total - 1, page + 1);
  if (from > 2) items.push("…");
  for (let p = from; p <= to; p++) items.push(p);
  if (to < total - 1) items.push("…");
  items.push(total);
  return items;
}

/** "Showing 1–10 of 77   ‹ Prev 1 2 … 8 Next ›". Hidden when everything fits on one page. */
export default function Pager({ label, page, totalPages, first, shown, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-stone-600">
        Showing {first + 1}–{first + shown} of {total}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => onPage(page - 1)} disabled={page === 1} className="nb-btn nb-btn-sm">
          ‹ Prev
        </button>
        {pageItems(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-stone-500">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`nb-btn nb-btn-sm min-w-9 ${p === page ? "nb-btn-primary" : ""}`}
            >
              {p}
            </button>
          ),
        )}
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="nb-btn nb-btn-sm">
          Next ›
        </button>
      </div>
    </nav>
  );
}
