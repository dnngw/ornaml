"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import SplitView from "./SplitView";
import { useMobileView } from "./useMobileView";
import CollectionDialog from "./CollectionDialog";
import { labeledSources } from "@/lib/cite";
import { shortName } from "@/lib/format";

const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-stone-400">Loading viewer…</p>,
});

const MAX_TABS = 5; // more papers than this: a dropdown instead of tabs

const SUGGESTIONS = [
  "Compare the main findings of these papers",
  "What method does each paper use?",
  "Which datasets are used, and by which paper?",
  "Where do the papers agree or disagree?",
];

async function fetchCollection(id) {
  const r = await fetch(`/api/collections/${id}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to load the collection");
  return j;
}

export default function CollectionView({ id }) {
  const [data, setData] = useState(null); // { collection, documents, strategy, limits }
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [focus, setFocus] = useState(null); // { messageId, sources, n, key }
  // Small screens show one pane at a time.
  const mobile = useMobileView();
  const [managing, setManaging] = useState(false);
  const seq = useRef(0);
  const scrollPositions = useRef(new Map()); // reading position per paper

  const load = useCallback(
    () =>
      fetchCollection(id)
        .then((j) => {
          setData(j);
          setActiveId((cur) =>
            j.documents.some((d) => d.id === cur)
              ? cur
              : ((j.documents.find((d) => d.status === "ready") ?? j.documents[0])?.id ?? null),
          );
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh while papers are still being prepared.
  const preparing = data?.documents.some((d) => d.status === "processing");
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [preparing, load]);

  function showCitations(message, n) {
    if (!message?.sources?.length) return setFocus(null);
    const sources = labeledSources(message);
    const target = sources.find((s) => s.n === (n ?? sources[0].n)) ?? sources[0];
    setFocus({ messageId: message.id, sources, n: target.n, key: ++seq.current });
    if (target.docId) setActiveId(target.docId); // open the cited paper
  }

  if (error) {
    return (
      <div className="p-10 text-sm">
        <p className="font-medium text-red-700">{error}</p>
        <Link href="/" className="mt-2 inline-block underline">
          Back to documents
        </Link>
      </div>
    );
  }
  if (!data) return <p className="p-10 text-sm text-stone-500">Loading…</p>;

  const { collection, documents, strategy, limits } = data;
  const ready = documents.filter((d) => d.status === "ready");
  const notReady = documents.filter((d) => d.status === "processing").length;
  const active = documents.find((d) => d.id === activeId);
  const citedDocs = new Set(focus?.sources.map((s) => s.docId));
  const activeHighlights = focus?.sources.filter((s) => s.docId === activeId) ?? [];
  const activeFocus = focus && activeHighlights.some((s) => s.n === focus.n) ? { key: focus.key, n: focus.n } : null;

  // Quick is described honestly: large collections don't read every paper whole.
  const quickHint =
    strategy === "search"
      ? "Good for most questions. Uses a short summary of each paper plus the most relevant parts, and answers quickly."
      : "Good for most questions. Reads all the papers together and answers quickly.";
  const deepCompareBase =
    ready.length < 2
      ? { available: false, reason: "Deep compare needs at least 2 papers in the collection." }
      : ready.length > limits.deepCompareMaxPapers
        ? {
            available: false,
            reason: `Deep compare works with up to ${limits.deepCompareMaxPapers} papers, and this collection has ${ready.length}.`,
          }
        : { available: true };

  const notes = [];
  if (strategy === "search") {
    notes.push(
      <p key="large">
        <span className="font-display font-bold">📚 Large collection:</span> answers use a short summary of every paper
        plus the most relevant parts of each one. For detailed comparisons, choose Deep compare as the answer mode.
      </p>,
    );
  }
  if (notReady > 0) {
    notes.push(
      <p key="preparing">
        ⏳ {notReady} paper{notReady === 1 ? " is" : "s are"} still being prepared and will be included once{" "}
        {notReady === 1 ? "it's" : "they're"} ready.
      </p>,
    );
  }

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b-2 border-ink bg-white px-3 text-sm">
      <Link href="/" className="nb-icon-btn bg-cite hover:bg-amber-400" title="Back to documents">
        ←
      </Link>
      <span className="min-w-0 truncate font-display font-bold" title={collection.name}>
        📁 {collection.name}
      </span>
      <span className="shrink-0 text-xs text-stone-500">
        {documents.length} paper{documents.length === 1 ? "" : "s"}
      </span>
      <button onClick={() => setManaging(true)} className="nb-btn nb-btn-sm ml-auto shrink-0">
        Manage papers
      </button>
    </div>
  );

  const paperPicker =
    documents.length === 0 ? null : documents.length <= MAX_TABS ? (
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b-2 border-ink bg-white px-3 py-2" role="tablist">
        {documents.map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={d.id === activeId}
            onClick={() => setActiveId(d.id)}
            title={d.name}
            className={`nb-btn nb-btn-sm relative shrink-0 ${d.id === activeId ? "nb-btn-primary" : ""}`}
          >
            {shortName(d.name, 22)}
            {d.status === "processing" && <span className="text-[10px] opacity-70">· preparing</span>}
            {citedDocs.has(d.id) && (
              <span
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-[1.5px] border-ink bg-cite"
                title="Cited in the highlighted answer"
              />
            )}
          </button>
        ))}
      </div>
    ) : (
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-ink bg-white px-3 py-2 text-sm">
        <span className="font-display font-bold">Paper</span>
        <select
          value={activeId ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
          className="nb-input flex-1 font-sans"
        >
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {citedDocs.has(d.id) ? "● " : ""}
              {d.name}
              {d.status === "processing" ? " (preparing…)" : ""}
            </option>
          ))}
        </select>
      </div>
    );

  const left = (
    <>
      {header}
      {paperPicker}
      {active && active.status !== "error" ? (
        <PdfViewer
          key={active.id}
          url={`/api/documents/${active.id}/file`}
          highlights={activeHighlights}
          focus={activeFocus}
          getInitialScrollTop={() => scrollPositions.current.get(active.id) ?? 0}
          onScrollTopChange={(top) => scrollPositions.current.set(active.id, top)}
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-stone-600">
          {documents.length === 0 ? (
            <div>
              <p className="font-display text-lg font-bold text-ink">This collection is empty</p>
              <p className="mt-1">Add papers to this collection to start asking questions.</p>
              <button onClick={() => setManaging(true)} className="nb-btn nb-btn-primary mt-4">
                Add papers
              </button>
            </div>
          ) : (
            <p>This paper couldn&apos;t be prepared. Open Documents to see why.</p>
          )}
        </div>
      )}
    </>
  );

  const right =
    ready.length > 0 ? (
      <ChatPanel
        endpoint={`/api/collections/${id}`}
        onCite={(message, source) => {
          showCitations(message, source.n);
          mobile.setView("pdf"); // small screens: jump to the cited passage
        }}
        onAnswer={(message, info) => {
          showCitations(message);
          if (info?.fresh) mobile.noteFreshAnswer();
        }}
        focusedMessageId={focus?.messageId}
        activeCite={focus && `${focus.messageId}:${focus.n}`}
        banner={notes.length > 0 && <div className="flex flex-col gap-1">{notes}</div>}
        suggestions={SUGGESTIONS}
        emptyTitle="Ask anything across these papers"
        emptyHint="Any language works. Answers say which paper each point comes from, and citations open the right PDF."
        notFoundTitle="Not found in these papers"
        notFoundHint={
          strategy === "search"
            ? "The parts searched didn't answer this. Try asking in a different way, or choose Deep compare as the answer mode."
            : "None of the papers seem to cover this. Try asking in a different way."
        }
        clearHint="The papers stay in your library."
        deepCompare={{ ...deepCompareBase, quickHint }}
      />
    ) : (
      <div className="grid flex-1 place-items-center p-6 text-center text-sm text-stone-600">
        <p>
          {documents.length === 0
            ? "Add papers to this collection to start asking questions."
            : "The papers in this collection are still being prepared. The chat opens once one is ready."}
        </p>
      </div>
    );

  return (
    <>
      <SplitView left={left} right={right} view={mobile.view} onViewChange={mobile.setView} chatBadge={mobile.badge} />
      {managing && (
        <CollectionDialog
          collection={collection}
          initialSelected={documents.map((d) => d.id)}
          onClose={() => setManaging(false)}
          onSaved={() => {
            setManaging(false);
            load();
          }}
        />
      )}
    </>
  );
}
