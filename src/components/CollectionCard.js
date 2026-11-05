"use client";

import Link from "next/link";

/** A collection on the Documents page: name, papers, and Ask / Delete. */
export default function CollectionCard({ collection, onDelete }) {
  return (
    <li className="nb-card flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-display font-bold" title={collection.name}>
          📁 {collection.name}
        </p>
        <p className="mt-0.5 text-xs text-stone-600">
          {collection.paper_count} paper{collection.paper_count === 1 ? "" : "s"}
          {collection.message_count > 0 && ` · ${collection.message_count} messages`}
        </p>
        {collection.paper_names.length > 0 && (
          <p className="mt-1.5 line-clamp-2 text-xs text-stone-700" title={collection.paper_names.join(", ")}>
            {collection.paper_names.slice(0, 3).join(" · ")}
            {collection.paper_names.length > 3 && ` · +${collection.paper_names.length - 3} more`}
          </p>
        )}
      </div>
      <div className="mt-auto flex items-center justify-end gap-2.5">
        <button onClick={onDelete} className="nb-btn nb-btn-sm nb-btn-danger">
          Delete
        </button>
        <Link href={`/collections/${collection.id}`} className="nb-btn nb-btn-primary">
          {collection.paper_count > 0 ? "Ask →" : "Add papers →"}
        </Link>
      </div>
    </li>
  );
}
