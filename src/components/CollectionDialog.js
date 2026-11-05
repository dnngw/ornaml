"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_COLLECTION_PAPERS } from "@/lib/limits";
import { uploadPdfs } from "@/lib/upload-client";

const fetchDocuments = () =>
  fetch("/api/documents", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => j.documents);

/**
 * Create a collection, or manage one (rename, choose papers, upload new ones).
 * Papers always live in the library; a collection only references them.
 * Render it only while open, so each opening starts from fresh state.
 */
export default function CollectionDialog({ collection = null, initialSelected = [], onClose, onSaved }) {
  const editing = Boolean(collection);
  const [name, setName] = useState(collection?.name ?? "");
  const [docs, setDocs] = useState(null);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const nameRef = useRef(null);
  const fileRef = useRef(null);

  const loadDocs = () => fetchDocuments().then(setDocs);

  useEffect(() => {
    fetchDocuments().then(setDocs);
    nameRef.current?.focus();
  }, []);

  // Keep statuses fresh while uploaded papers are still being prepared.
  const processing = docs?.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => fetchDocuments().then(setDocs), 1500);
    return () => clearInterval(t);
  }, [processing]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const full = selected.size >= MAX_COLLECTION_PAPERS;
  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COLLECTION_PAPERS) next.add(id);
      return next;
    });

  async function upload(files) {
    setError("");
    setUploading(files.length);
    const { ids, problems } = await uploadPdfs(files, { onFileDone: () => setUploading((n) => Math.max(0, n - 1)) });
    setUploading(0);
    await loadDocs();
    // New uploads are selected while there's room; the rest stay in the library.
    const added = ids.slice(0, Math.max(0, MAX_COLLECTION_PAPERS - selected.size));
    setSelected((s) => new Set([...s, ...added]));
    if (added.length < ids.length) {
      problems.push(
        `${ids.length - added.length} uploaded file(s) are in your library but weren't added: a collection holds up to ${MAX_COLLECTION_PAPERS} papers.`,
      );
    }
    setError(problems.join("\n"));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(editing ? `/api/collections/${collection.id}` : "/api/collections", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, documentIds: [...selected] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The collection couldn't be saved.");
      onSaved?.(editing ? collection.id : j.id);
    } catch (e) {
      setError(e.message === "Failed to fetch" ? "The app couldn't be reached. Is it still running?" : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px] animate-[nb-fade_120ms_ease-out]"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-dialog-title"
        className="nb-card flex max-h-[90vh] w-full max-w-lg flex-col p-6 animate-[nb-pop_160ms_ease-out]"
      >
        <h2 id="collection-dialog-title" className="font-display text-xl font-bold">
          {editing ? "Manage collection" : "New collection"}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          A collection groups papers so you can ask questions across all of them. The papers stay in your library.
        </p>

        <label className="mt-4 block">
          <span className="font-display text-sm font-bold">Name</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Literature for chapter 2"
            className="nb-input mt-1.5 font-sans"
          />
        </label>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-display text-sm font-bold">Papers</span>
          <span className={`text-xs ${full ? "font-bold text-ink" : "text-stone-500"}`}>
            {selected.size} of {MAX_COLLECTION_PAPERS} selected
          </span>
        </div>
        <div className="mt-1.5 min-h-24 flex-1 overflow-y-auto rounded-md border-2 border-ink bg-white">
          {docs === null ? (
            <p className="p-3 text-sm text-stone-500">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="p-3 text-sm text-stone-500">Your library is empty. Upload PDFs below.</p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {docs.map((d) => {
                const checked = selected.has(d.id);
                const unusable = d.status === "error";
                return (
                  <li key={d.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${
                        unusable || (full && !checked) ? "opacity-50" : "cursor-pointer hover:bg-accent-soft/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={unusable || (full && !checked)}
                        onChange={() => toggle(d.id)}
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium" title={d.name}>
                        {d.name}
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">
                        {unusable
                          ? "couldn't be prepared"
                          : d.status === "processing"
                            ? "preparing…"
                            : `${d.num_pages} page${d.num_pages === 1 ? "" : "s"}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-stone-600">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
            className="nb-btn nb-btn-sm"
          >
            ⬆ Upload new PDFs
          </button>
          <span>
            {uploading > 0
              ? `Uploading ${uploading} file(s)…`
              : "New uploads are added to your library and selected here."}
          </span>
          <input
            ref={fileRef}
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
          <p className="mt-3 whitespace-pre-line rounded-md border-2 border-ink bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="nb-btn">
            Cancel
          </button>
          <button onClick={save} disabled={busy || uploading > 0 || !name.trim()} className="nb-btn nb-btn-primary">
            {busy ? "Saving…" : editing ? "Save" : "Create collection"}
          </button>
        </div>
      </div>
    </div>
  );
}
