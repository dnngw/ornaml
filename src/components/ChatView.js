"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import SplitView from "./SplitView";
import { useMobileView } from "./useMobileView";
import { isLongDocument } from "@/lib/limits";
import { labeledSources } from "@/lib/cite";

// pdf.js needs browser APIs, so the viewer is client-only.
const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-stone-400">Loading viewer…</p>,
});

export default function ChatView({ id }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  // Citations of one answer shown in the PDF; `n` is the emphasized one.
  const [focus, setFocus] = useState(null); // { messageId, sources, n, key }
  // Small screens show one pane at a time.
  const mobile = useMobileView();
  const seq = useRef(0);

  function showCitations(message, n) {
    if (!message?.sources?.length) return setFocus(null);
    const sources = labeledSources(message);
    setFocus({
      messageId: message.id,
      sources,
      n: n ?? sources[0].n, // default: the answer's first citation
      key: ++seq.current,
    });
  }

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load document");
        setDoc(j.document);
      })
      .catch((e) => setError(e.message));
  }, [id]);

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
  if (!doc) return <p className="p-10 text-sm text-stone-500">Loading…</p>;

  return (
    <SplitView
      view={mobile.view}
      onViewChange={mobile.setView}
      chatBadge={mobile.badge}
      left={
        <>
          <div className="flex h-12 shrink-0 items-center gap-3 border-b-2 border-ink bg-white px-3 text-sm">
            <Link href="/" className="nb-icon-btn bg-cite hover:bg-amber-400" title="Back to documents">
              ←
            </Link>
            <span className="truncate font-display font-bold" title={doc.name}>
              {doc.name}
            </span>
          </div>
          <PdfViewer
            url={`/api/documents/${id}/file`}
            highlights={focus?.sources}
            focus={focus && { key: focus.key, n: focus.n }}
          />
        </>
      }
      right={
        doc.status === "ready" ? (
          <ChatPanel
            endpoint={`/api/documents/${id}`}
            onCite={(message, source) => {
              showCitations(message, source.n);
              mobile.setView("pdf"); // small screens: jump to the cited passage
            }}
            onAnswer={(message, info) => {
              showCitations(message);
              if (info?.fresh) mobile.noteFreshAnswer();
            }}
            banner={
              isLongDocument(doc) && (
                <>
                  <span aria-hidden>📖</span>
                  <p>
                    <span className="font-display font-bold">Long document:</span> answers are based on the most
                    relevant sections, so some details may be missed. Asking about a specific chapter or section helps.
                  </p>
                </>
              )
            }
            notFoundHint={
              isLongDocument(doc)
                ? "The sections searched didn't answer this. Try the terms the document itself would use, or name a chapter or section (e.g. “in the results section”)."
                : undefined
            }
            focusedMessageId={focus?.messageId}
            activeCite={focus && `${focus.messageId}:${focus.n}`}
          />
        ) : (
          <div className="p-6 text-sm text-stone-500">
            This document isn&apos;t ready ({doc.status}). {doc.error}{" "}
            <Link href="/" className="underline">
              Back to documents
            </Link>
          </div>
        )
      }
    />
  );
}
