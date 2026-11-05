"use client";

import Link from "next/link";
import { formatBytes, formatDate, formatShortDate } from "@/lib/format";
import { isLongDocument } from "@/lib/limits";
import { FIX_IN_SETTINGS } from "@/lib/errors";

// Retrying the same file won't help for these.
const NO_RETRY = new Set(["no_text", "bad_pdf", "too_many_pages"]);

/** Turn the machine-readable progress ("extracting", "embedding:12/49") into words + a fraction. */
function progressInfo(progress) {
  const m = progress?.match(/^embedding:(\d+)\/(\d+)$/);
  if (m) {
    const total = Number(m[2]);
    return { label: "Preparing the document for questions…", fraction: total ? Number(m[1]) / total : 0 };
  }
  if (progress === "extracting") return { label: "Reading the PDF…", fraction: null };
  return { label: "Waiting to start…", fraction: null };
}

/** One paper in the library: details, processing / error status and actions. */
export default function DocumentCard({ doc, selected, onToggle, onDelete, onReprocess }) {
  return (
    <li
      // Small screens: checkbox + details on top, actions on their own row.
      className={`nb-card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:flex-nowrap ${
        selected ? "bg-accent-soft" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={doc.status === "error"}
        onChange={onToggle}
        aria-label={`Select ${doc.name}`}
        className="h-4 w-4 shrink-0 accent-accent"
      />
      <div className="hidden h-12 w-10 shrink-0 place-items-center rounded border-2 border-ink bg-accent-soft font-display text-[10px] font-bold sm:grid">
        PDF
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words font-display font-bold sm:line-clamp-none sm:truncate" title={doc.name}>
          {doc.name}
        </p>
        <p className="mt-0.5 text-xs text-stone-600">
          {[doc.num_pages && `${doc.num_pages} page${doc.num_pages === 1 ? "" : "s"}`, formatBytes(doc.size)]
            .filter(Boolean)
            .join(" · ")}
          {" · "}
          <span className="sm:hidden">{formatShortDate(doc.created_at)}</span>
          <span className="hidden sm:inline">{formatDate(doc.created_at)}</span>
          {doc.message_count > 0 && ` · ${doc.message_count} messages`}
        </p>
        {doc.collection_names?.length > 0 && (
          <p className="mt-1 truncate text-xs text-stone-600" title={doc.collection_names.join(", ")}>
            📁 {doc.collection_names.join(", ")}
          </p>
        )}
        {doc.status === "ready" && isLongDocument(doc) && (
          <p className="mt-1.5 text-xs text-stone-600">
            📖 Long document: answers are based on the most relevant sections.
          </p>
        )}
        {doc.status === "processing" && <ProcessingStatus progress={doc.progress} />}
        {doc.status === "error" && <ErrorStatus doc={doc} />}
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2.5 sm:w-auto sm:flex-nowrap">
        {doc.status === "error" && FIX_IN_SETTINGS.has(doc.error_code) && (
          <Link href="/settings" className="nb-btn nb-btn-sm nb-btn-primary">
            Open Settings
          </Link>
        )}
        {doc.status === "error" && !NO_RETRY.has(doc.error_code) && (
          <button onClick={onReprocess} className="nb-btn nb-btn-sm">
            ↻ Try again
          </button>
        )}
        <button onClick={onDelete} className="nb-btn nb-btn-sm nb-btn-danger">
          Delete
        </button>
        {doc.status === "ready" ? (
          <Link href={`/documents/${doc.id}`} className="nb-btn nb-btn-primary">
            Ask →
          </Link>
        ) : (
          <button disabled className="nb-btn">
            Ask →
          </button>
        )}
      </div>
    </li>
  );
}

function ProcessingStatus({ progress }) {
  const { label, fraction } = progressInfo(progress);
  const pct = fraction === null ? null : Math.round(fraction * 100);
  return (
    <div className="mt-2 max-w-sm">
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{label}</span>
        {pct !== null && <span className="font-display font-bold tabular-nums">{pct}%</span>}
      </div>
      <div
        className="nb-progress mt-1"
        role="progressbar"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {pct === null ? (
          <div className="nb-progress-indeterminate" />
        ) : (
          <div className="nb-progress-fill" style={{ width: `${Math.max(4, pct)}%` }} />
        )}
      </div>
    </div>
  );
}

function ErrorStatus({ doc }) {
  return (
    <div className="mt-2 max-w-lg rounded-md border-2 border-ink bg-red-50 px-3 py-2 text-xs">
      <p className="font-medium text-red-900">
        <span className="mr-1 font-display font-bold">Couldn&apos;t prepare this PDF.</span>
        {doc.error}
      </p>
      {doc.error_detail && (
        <details className="mt-1 text-stone-600">
          <summary className="cursor-pointer select-none underline underline-offset-2">Show details</summary>
          <p className="mt-1 break-words font-mono text-[11px]">{doc.error_detail}</p>
        </details>
      )}
    </div>
  );
}
