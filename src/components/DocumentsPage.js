"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import CollectionDialog from "./CollectionDialog";
import InfoTip from "./InfoTip";
import Pager from "./Pager";
import DocumentCard from "./DocumentCard";
import CollectionCard from "./CollectionCard";
import { MAX_PAGES, MAX_UPLOAD_MB } from "@/lib/limits";
import { uploadPdfs } from "@/lib/upload-client";

// Collections: 4 per page (two rows of cards), most recently used first.
const COLLECTIONS_PER_PAGE = 4;

// Library list: paginated (10 / 25 / 50 per page), searchable once there are more than 8 papers.
const PAGE_SIZES = [10, 25, 50];
const LIBRARY_SORTS = {
  newest: { label: "Newest first", compare: (a, b) => b.created_at - a.created_at },
  oldest: { label: "Oldest first", compare: (a, b) => a.created_at - b.created_at },
  name: {
    label: "Name A–Z",
    compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  },
  chatted: {
    label: "Most chatted",
    compare: (a, b) => b.message_count - a.message_count || b.created_at - a.created_at,
  },
};

// "Show" filter: fixed views plus one per collection ("col:<id>").
const LIBRARY_VIEWS = {
  all: { label: "All papers", test: () => true },
  loose: { label: "Not in a collection", test: (d) => !d.collection_ids?.length },
  attention: { label: "Needs attention", test: (d) => d.status === "error" },
};
function libraryViewTest(view) {
  if (view.startsWith("col:")) {
    const id = view.slice(4);
    return (d) => d.collection_ids?.includes(id);
  }
  return (LIBRARY_VIEWS[view] ?? LIBRARY_VIEWS.all).test;
}

async function fetchLibrary() {
  const [d, c] = await Promise.all([
    fetch("/api/documents", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/collections", { cache: "no-store" }).then((r) => r.json()),
  ]);
  return { docs: d.documents, collections: c.collections };
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState(null);
  const [settings, setSettings] = useState(null);
  const [uploading, setUploading] = useState([]); // file names in flight
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [toDelete, setToDelete] = useState(null); // document awaiting confirmation
  const [deleting, setDeleting] = useState(false);
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState(() => new Set()); // library papers ticked for a collection
  const [creating, setCreating] = useState(null); // { initialSelected } while the dialog is open
  const [collectionToDelete, setCollectionToDelete] = useState(null);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionPage, setCollectionPage] = useState(1);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [librarySort, setLibrarySort] = useState("newest");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [libraryPage, setLibraryPage] = useState(1);
  const libraryRef = useRef(null);
  const inputRef = useRef(null);
  const router = useRouter();

  const apply = useCallback((lib) => {
    setDocs(lib.docs);
    setCollections(lib.collections);
    // Drop selections of papers that no longer exist.
    setSelected((s) => new Set([...s].filter((id) => lib.docs.some((d) => d.id === id))));
  }, []);
  const load = useCallback(() => fetchLibrary().then(apply), [apply]);

  useEffect(() => {
    fetchLibrary().then(apply);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => setSettings(j.settings))
      .catch(() => {});
  }, [apply]);

  // Poll while anything is processing.
  const processing = docs?.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [processing, load]);

  async function upload(files) {
    setError("");
    const names = [...files].map((f) => f.name);
    setUploading((u) => [...u, ...names]);
    const { problems } = await uploadPdfs(files, {
      onFileDone: (name) =>
        setUploading((u) => {
          const i = u.indexOf(name);
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        }),
    });
    setError(problems.join("\n"));
    // Show the new uploads (newest first, page 1) even if a search, filter or sort was active.
    setLibraryQuery("");
    setLibraryFilter("all");
    setLibrarySort("newest");
    setLibraryPage(1);
    load();
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${toDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(`${toDelete.name}: ${j.error || res.statusText}`);
      }
      await load();
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  const toggleSelected = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function addSelectedTo(collectionId) {
    setError("");
    const res = await fetch(`/api/collections/${collectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addDocumentIds: [...selected] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error || "The papers couldn't be added.");
    else setSelected(new Set());
    load();
  }

  async function confirmDeleteCollection() {
    setDeleting(true);
    try {
      await fetch(`/api/collections/${collectionToDelete.id}`, { method: "DELETE" });
      await load();
    } finally {
      setDeleting(false);
      setCollectionToDelete(null);
    }
  }

  // Search matches the collection name or any of its papers.
  const q = collectionQuery.trim().toLowerCase();
  const matchingCollections = q
    ? collections.filter((c) => [c.name, ...c.paper_names].some((t) => t.toLowerCase().includes(q)))
    : collections;
  const collectionPages = Math.max(1, Math.ceil(matchingCollections.length / COLLECTIONS_PER_PAGE));
  const cPage = Math.min(collectionPage, collectionPages); // e.g. after deleting the last one on a page
  const cFirst = (cPage - 1) * COLLECTIONS_PER_PAGE;
  const visibleCollections = matchingCollections.slice(cFirst, cFirst + COLLECTIONS_PER_PAGE);

  // Library: filter -> search -> first N. Selections live outside, so they survive all three.
  const countFor = (view) => (docs ?? []).filter(libraryViewTest(view)).length;
  // A view that no longer applies (nothing needs attention, collection deleted) falls back to All papers.
  const viewStillValid =
    libraryFilter === "all" ||
    (libraryFilter.startsWith("col:")
      ? collections.some((c) => `col:${c.id}` === libraryFilter)
      : countFor(libraryFilter) > 0);
  const activeFilter = viewStillValid ? libraryFilter : "all";
  const lq = libraryQuery.trim().toLowerCase();
  const matchingDocs = (docs ?? [])
    .filter(libraryViewTest(activeFilter))
    .filter((d) => !lq || [d.name, ...(d.collection_names ?? [])].some((t) => t.toLowerCase().includes(lq)))
    .sort(LIBRARY_SORTS[librarySort].compare);
  const totalPages = Math.max(1, Math.ceil(matchingDocs.length / pageSize));
  const page = Math.min(libraryPage, totalPages); // e.g. after deleting the last paper of the last page
  const firstIndex = (page - 1) * pageSize;
  const visibleDocs = matchingDocs.slice(firstIndex, firstIndex + pageSize);
  const visibleIds = new Set(visibleDocs.map((d) => d.id));
  const hiddenSelected = [...selected].filter((id) => !visibleIds.has(id)).length;
  // Any change to search, filter, sort or page size starts again at page 1.
  const changeLibraryView = (fn) => {
    fn();
    setLibraryPage(1);
  };
  const goToPage = (p) => {
    setLibraryPage(p);
    // Keep the controls in view when jumping from the bottom of a long page.
    const top = libraryRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) libraryRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function reprocess(doc) {
    await fetch(`/api/documents/${doc.id}/reprocess`, { method: "POST" });
    load();
  }

  // Only the chat key is essential: the embedding key is needed just for long
  // documents, and those report a clear "add the key in Settings" error themselves.
  const missingChatKey = settings && !settings.chat_api_key.set;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-12">
      <span className="nb-tag">Chat with your PDFs</span>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">Your documents</h1>
      <p className="mt-2 max-w-xl text-stone-600">
        Upload a PDF, then ask questions about it. Answers cite the exact passages and highlight them in the page.
      </p>

      {missingChatKey && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-ink bg-cite px-4 py-3 text-sm font-medium shadow-[3px_3px_0_var(--ink)]">
          <span>The chat API key isn&apos;t set yet, so questions can&apos;t be answered.</span>
          <Link href="/settings" className="nb-btn nb-btn-sm">
            Open Settings →
          </Link>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mt-8 flex cursor-pointer flex-col items-center justify-center rounded-md border-[2.5px] border-dashed border-ink px-6 py-12 text-center transition-all ${
          dragging ? "bg-accent-soft shadow-[5px_5px_0_var(--ink)]" : "bg-white hover:bg-accent-soft/40"
        }`}
      >
        <span className="grid h-14 w-14 place-items-center rounded-md border-2 border-ink bg-accent text-white shadow-[3px_3px_0_var(--ink)]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </span>
        <p className="mt-4 font-display text-lg font-bold">Drop PDFs here or click to upload</p>
        <p className="mt-1 text-xs text-stone-600">
          Text-based PDFs up to {MAX_UPLOAD_MB} MB and {MAX_PAGES} pages. Scanned PDFs (images only) aren&apos;t
          supported yet.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p className="mt-4 whitespace-pre-line rounded-md border-2 border-ink bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      {uploading.length > 0 && <p className="mt-4 text-sm font-medium">Uploading {uploading.join(", ")}…</p>}

      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold">
              Collections {collections.length > 0 && <span className="text-stone-500">({collections.length})</span>}
            </h2>
            <InfoTip label="What is a collection?">
              <strong className="font-display text-ink">A folder of papers you ask about together</strong>, e.g. to
              compare their methods or results. It only points to papers in your library (nothing is copied) and has its
              own chat. Deleting a collection never deletes the papers.
            </InfoTip>
          </div>
          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            {collections.length > 0 && (
              <input
                type="search"
                value={collectionQuery}
                onChange={(e) => {
                  setCollectionQuery(e.target.value);
                  setCollectionPage(1);
                }}
                placeholder="Search collections…"
                aria-label="Search collections"
                className="nb-input min-w-0 flex-1 py-1 font-sans sm:w-56 sm:flex-none"
              />
            )}
            <button onClick={() => setCreating({ initialSelected: [] })} className="nb-btn nb-btn-sm shrink-0">
              + New collection
            </button>
          </div>
        </div>
        {collections.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">
            Group papers into a collection to ask questions across all of them. Tick papers in the library below, or
            click New collection.
          </p>
        ) : (
          <>
            {visibleCollections.length === 0 && (
              <p className="mt-3 text-sm text-stone-600">
                No collections match &ldquo;{collectionQuery.trim()}&rdquo;. Search looks at collection names and the
                papers inside them.
              </p>
            )}
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {visibleCollections.map((c) => (
                <CollectionCard key={c.id} collection={c} onDelete={() => setCollectionToDelete(c)} />
              ))}
            </ul>
            <Pager
              label="Collection pages"
              page={cPage}
              totalPages={collectionPages}
              first={cFirst}
              shown={visibleCollections.length}
              total={matchingCollections.length}
              onPage={setCollectionPage}
            />
          </>
        )}
      </div>

      <div ref={libraryRef} className="mt-10 scroll-mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold">
              Library {docs?.length > 0 && <span className="text-stone-500">({docs.length})</span>}
            </h2>
            <InfoTip label="What is the library?">
              <strong className="font-display text-ink">Every PDF you&apos;ve uploaded.</strong> Each paper has its own
              chat: click <em>Ask</em> to ask about that paper alone. Tick papers to put them in a collection.
            </InfoTip>
          </div>
          {docs?.length > 0 && (
            <input
              type="search"
              value={libraryQuery}
              onChange={(e) => changeLibraryView(() => setLibraryQuery(e.target.value))}
              placeholder="Search papers or collections…"
              aria-label="Search papers"
              className="nb-input w-full py-1 font-sans sm:w-64"
            />
          )}
        </div>
        {docs?.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-display font-bold">Show</span>
              <select
                value={activeFilter}
                onChange={(e) => changeLibraryView(() => setLibraryFilter(e.target.value))}
                className={`nb-input w-auto max-w-[16rem] py-1 font-sans ${activeFilter === "all" ? "" : "bg-accent-soft"}`}
              >
                <option value="all">All papers ({docs.length})</option>
                <option value="loose">Not in a collection ({countFor("loose")})</option>
                {countFor("attention") > 0 && (
                  <option value="attention">⚠ Needs attention ({countFor("attention")})</option>
                )}
                {collections.length > 0 && (
                  <optgroup label="Collections">
                    {collections.map((c) => (
                      <option key={c.id} value={`col:${c.id}`}>
                        📁 {c.name} ({c.paper_count})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-display font-bold">Sort</span>
              <select
                value={librarySort}
                onChange={(e) => changeLibraryView(() => setLibrarySort(e.target.value))}
                className="nb-input w-auto py-1 font-sans"
              >
                {Object.entries(LIBRARY_SORTS).map(([k, o]) => (
                  <option key={k} value={k}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="font-display font-bold">Per page</span>
              <select
                value={pageSize}
                onChange={(e) => changeLibraryView(() => setPageSize(Number(e.target.value)))}
                className="nb-input w-auto py-1 font-sans"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {docs?.length > 0 && (
          <p className="mt-2 text-xs text-stone-600">Tick papers to group them into a collection.</p>
        )}
        {docs === null ? (
          <p className="mt-3 text-sm text-stone-500">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No documents yet. Upload your first PDF above.</p>
        ) : matchingDocs.length === 0 ? (
          <p className="mt-4 text-sm text-stone-600">
            {lq
              ? `No papers match “${libraryQuery.trim()}”. Search looks at file names and collection names.`
              : activeFilter === "loose"
                ? "Every paper is in a collection."
                : "Nothing here."}
          </p>
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-4">
              {visibleDocs.map((d) => (
                <DocumentCard
                  key={d.id}
                  doc={d}
                  selected={selected.has(d.id)}
                  onToggle={() => toggleSelected(d.id)}
                  onDelete={() => setToDelete(d)}
                  onReprocess={() => reprocess(d)}
                />
              ))}
            </ul>
            <Pager
              label="Library pages"
              page={page}
              totalPages={totalPages}
              first={firstIndex}
              shown={visibleDocs.length}
              total={matchingDocs.length}
              onPage={goToPage}
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        danger
        busy={deleting}
        title="Delete this document?"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        {toDelete && (
          <>
            <p className="break-words rounded border-[1.5px] border-ink bg-background px-2.5 py-1.5 font-display font-bold text-ink">
              {toDelete.name}
            </p>
            <p className="mt-3">
              The PDF
              {toDelete.message_count > 0
                ? ` and its chat history (${toDelete.message_count} messages) will be permanently deleted.`
                : " will be permanently deleted."}{" "}
              {toDelete.collection_names?.length > 0 &&
                `It will also be removed from ${toDelete.collection_names.length} collection${
                  toDelete.collection_names.length === 1 ? "" : "s"
                }. `}
              This can&apos;t be undone.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(collectionToDelete)}
        danger
        busy={deleting}
        title="Delete this collection?"
        confirmLabel="Delete collection"
        onConfirm={confirmDeleteCollection}
        onCancel={() => setCollectionToDelete(null)}
      >
        {collectionToDelete && (
          <>
            <p className="break-words rounded border-[1.5px] border-ink bg-background px-2.5 py-1.5 font-display font-bold text-ink">
              📁 {collectionToDelete.name}
            </p>
            <p className="mt-3">
              The collection
              {collectionToDelete.message_count > 0 &&
                ` and its chat history (${collectionToDelete.message_count} messages)`}{" "}
              will be deleted. The papers stay in your library. This can&apos;t be undone.
            </p>
          </>
        )}
      </ConfirmDialog>

      {creating && (
        <CollectionDialog
          initialSelected={creating.initialSelected}
          onClose={() => {
            setCreating(null);
            load(); // papers uploaded inside the dialog are in the library even if it's cancelled
          }}
          onSaved={(id) => {
            setCreating(null);
            setSelected(new Set());
            router.push(`/collections/${id}`);
          }}
        />
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-40 mt-6 flex flex-wrap items-center gap-3 rounded-md border-2 border-ink bg-white px-4 py-3 shadow-[4px_4px_0_var(--ink)]">
          <span className="font-display font-bold">
            {selected.size} selected
            {hiddenSelected > 0 && (
              <span className="ml-1 font-sans text-xs font-normal text-stone-600">
                ({hiddenSelected} not on this page)
              </span>
            )}
          </span>
          <button
            onClick={() => setCreating({ initialSelected: [...selected] })}
            className="nb-btn nb-btn-sm nb-btn-primary"
          >
            📁 New collection
          </button>
          {collections.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && addSelectedTo(e.target.value)}
              className="nb-input w-auto py-1 font-sans text-sm"
              aria-label="Add to an existing collection"
            >
              <option value="">Add to collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setSelected(new Set())} className="nb-btn nb-btn-sm ml-auto">
            ✕ Clear
          </button>
        </div>
      )}
    </div>
  );
}
