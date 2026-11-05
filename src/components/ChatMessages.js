"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE_RE, citationLabels, labeledSources } from "@/lib/cite";
import { shortName } from "@/lib/format";

/** Turn [S1][S2, S3] markers into links the Markdown renderer maps to chips. */
function linkCitations(text) {
  return text.replace(CITE_RE, (_, inner) =>
    inner
      .match(/\d+/g)
      .map((n) => `[${n}](#cite-${n})`)
      .join(""),
  );
}

export function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-md border-2 border-ink bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-[2px_2px_0_var(--ink)]">
        {text}
      </div>
    </div>
  );
}

export function AssistantMessage({ message, onCite, activeCite, focused, streaming, notFoundTitle, notFoundHint }) {
  // Users see 1, 2, 3… per answer; `n` (the chunk number) stays internal.
  const labels = citationLabels(message.content);
  const sources = labeledSources(message);
  const byN = new Map(sources.map((s) => [s.n, s]));

  const components = {
    a({ href, children }) {
      const m = href?.match(/^#cite-(\d+)$/);
      if (!m)
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      const n = Number(m[1]);
      const src = byN.get(n);
      return (
        <CiteChip
          label={labels.get(n) ?? "?"}
          source={src}
          active={activeCite === `${message.id}:${n}`}
          onClick={src ? () => onCite?.(message, src) : undefined}
        />
      );
    },
  };

  return (
    <div className="text-sm text-ink">
      {message.strategy === "deep" && (
        <p className="mb-2 inline-block rounded border-[1.5px] border-ink bg-accent-soft px-2 py-0.5 text-[11px] font-medium">
          🔍 Deep compare · {message.papers_read} papers read in full
        </p>
      )}
      <div className="prose-chat">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {linkCitations(message.content)}
        </ReactMarkdown>
        {streaming && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-middle" />}
      </div>

      {message.found === false && (
        <div className="mt-3 flex gap-2.5 rounded-md border-2 border-ink bg-stone-100 px-3 py-2.5 text-xs">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded border-2 border-ink bg-white font-display font-bold">
            ?
          </span>
          <div>
            <p className="font-display font-bold">{notFoundTitle}</p>
            <p className="mt-0.5 text-stone-600">{notFoundHint}</p>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="font-display text-[11px] font-bold uppercase tracking-wide text-stone-500">
            {focused ? "Sources · highlighted in the PDF" : "Sources · click to show in the PDF"}
          </p>
          {sources.map((s) => {
            const active = activeCite === `${message.id}:${s.n}`;
            return (
              <button
                key={s.n}
                onClick={() => onCite?.(message, s)}
                className={`flex gap-2 rounded-md border-[1.5px] border-ink px-2.5 py-1.5 text-left text-xs transition ${
                  active ? "bg-cite shadow-[2px_2px_0_var(--ink)]" : "bg-white hover:bg-cite/40"
                }`}
              >
                <span className="shrink-0 font-display font-bold">
                  {s.label}
                  {s.docName && <span className="font-medium text-stone-600"> · {shortName(s.docName)}</span>} · p.
                  {s.page}
                </span>
                <span className="line-clamp-2 flex-1 text-stone-700">“{s.quote || s.excerpt}”</span>
                {!s.exact && (
                  <span
                    className="shrink-0 self-start rounded border-[1.5px] border-dashed border-stone-500 px-1.5 text-[10px] font-medium text-stone-600"
                    title="The quote couldn't be matched exactly in the PDF, so the whole passage is highlighted. Double-check this one."
                  >
                    ≈ approximate
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CiteChip({ label, source, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={
        source
          ? `${source.docName ? `${source.docName} · ` : ""}Page ${source.page}${source.exact ? "" : " · approximate match"}`
          : undefined
      }
      className={`mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] border-[1.5px] px-1 align-[1px] font-display text-[10px] font-bold transition-colors ${
        active
          ? "border-ink bg-amber-500 text-ink"
          : source
            ? "border-ink bg-cite text-ink hover:bg-amber-400"
            : "border-stone-300 bg-stone-100 text-stone-400"
      } ${source && !source.exact ? "border-dashed" : ""}`}
    >
      {label}
    </button>
  );
}
