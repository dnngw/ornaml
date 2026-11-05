"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FIX_IN_SETTINGS } from "@/lib/errors";
import ConfirmDialog from "./ConfirmDialog";
import { AssistantMessage, UserBubble } from "./ChatMessages";

const DOCUMENT_SUGGESTIONS = [
  "Summarize this document",
  "What are the main contributions or findings?",
  "What method or approach is used?",
  "What are the limitations?",
];

/** Plain-language progress for the steps before the answer starts streaming. */
function statusText(status, thinking) {
  if (status?.kind === "preparing") {
    const n = status.count;
    return `Getting ${n} paper${n === 1 ? "" : "s"} ready for searching (only needed once)…`;
  }
  if (status?.kind === "reading") return `Reading every paper in full… ${status.index} of ${status.total} done`;
  if (status?.kind === "comparing") return "Comparing what the papers say…";
  return thinking ? "Thinking…" : "Reading…";
}

/** Hide the trailing <quotes> block (and a partially streamed "<quo…"). */
function visibleText(raw) {
  const i = raw.indexOf("<quotes");
  if (i >= 0) return raw.slice(0, i);
  for (let k = Math.min(7, raw.length); k > 0; k--) {
    if ("<quotes".startsWith(raw.slice(-k))) return raw.slice(0, -k);
  }
  return raw;
}

/**
 * Chat for one paper or a collection.
 * @param endpoint      "/api/documents/<id>" or "/api/collections/<id>" (uses /messages and /chat)
 * @param banner        optional note under the header (e.g. long document / large collection)
 * @param deepCompare   collections only: { available, reason, quickHint } for the answer-mode choice
 */
export default function ChatPanel({
  endpoint,
  onCite,
  onAnswer,
  focusedMessageId,
  activeCite,
  banner,
  suggestions = DOCUMENT_SUGGESTIONS,
  emptyTitle = "Ask anything about this document",
  emptyHint = "Any language works. Cited passages are highlighted in the PDF.",
  notFoundTitle = "Not found in this document",
  notFoundHint = "The document doesn't seem to cover this. Try asking in a different way.",
  clearHint = "The PDF itself stays in your library.",
  deepCompare = null,
}) {
  const [messages, setMessages] = useState(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // streaming assistant text
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState(null); // preparing / reading / comparing
  const [deepOn, setDeepOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, code }
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const tempSeq = useRef(0);

  useEffect(() => {
    fetch(`${endpoint}/messages`)
      .then((r) => r.json())
      .then((j) => {
        const msgs = j.messages || [];
        setMessages(msgs);
        // Show the latest answer's citations in the PDF right away.
        const last = msgs.findLast((m) => m.role === "assistant" && m.sources?.length);
        if (last) onAnswer?.(last);
      });
  }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, pending]);

  async function send(question) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    const tempId = `tmp-${++tempSeq.current}`;
    setMessages((m) => [...m, { id: tempId, role: "user", content: q }]);

    const removeTemp = (realId) => setMessages((m) => m.filter((x) => x.id !== tempId && x.id !== realId));

    const controller = new AbortController();
    abortRef.current = controller;
    const deep = Boolean(deepCompare?.available && deepOn);
    setDeepOn(false); // Deep compare applies to one question at a time (it costs more)
    let raw = "";
    try {
      const res = await fetch(`${endpoint}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, deep }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { code: j.code });
      }
      setPending("");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let realUserId = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const ev = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (ev.type === "user") {
            realUserId = ev.message.id;
            setMessages((m) => m.map((x) => (x.id === tempId ? ev.message : x)));
          } else if (ev.type === "status") {
            setStatus(ev);
          } else if (ev.type === "thinking") {
            setStatus(null);
            setThinking(true);
          } else if (ev.type === "delta") {
            setThinking(false);
            setStatus(null);
            raw += ev.text;
            setPending(visibleText(raw));
          } else if (ev.type === "done") {
            setMessages((m) => [...m, ev.message]);
            setPending(null);
            onAnswer?.(ev.message, { fresh: true }); // a new answer, not one loaded from history
          } else if (ev.type === "error") {
            removeTemp(realUserId);
            throw Object.assign(new Error(ev.error), { code: ev.code });
          }
        }
      }
    } catch (e) {
      setPending(null);
      if (e.name === "AbortError") {
        // The server saves partial answers; reload to stay in sync.
        const j = await fetch(`${endpoint}/messages`).then((r) => r.json());
        setMessages(j.messages || []);
      } else {
        removeTemp(null);
        setError({
          message: e.message === "Failed to fetch" ? "The app couldn't be reached. Is it still running?" : e.message,
          code: e.code,
        });
        setInput(q);
      }
    } finally {
      setBusy(false);
      setThinking(false);
      setStatus(null);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  async function clearChat() {
    setClearing(true);
    try {
      const res = await fetch(`${endpoint}/messages`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMessages([]);
      setError(null);
      onAnswer?.(null);
    } catch {
      setError({ message: "The chat couldn't be cleared. Is the app still running?" });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b-2 border-ink px-4 text-sm">
        <span className="font-display font-bold">Chat</span>
        {messages?.length > 0 && (
          <button onClick={() => setConfirmClear(true)} disabled={busy} className="nb-btn nb-btn-sm nb-btn-danger">
            Clear chat
          </button>
        )}
      </div>

      {banner && (
        <div className="flex shrink-0 gap-2 border-b-2 border-ink bg-accent-soft px-4 py-2 text-xs">{banner}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages === null ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : messages.length === 0 && pending === null ? (
          <div className="mx-auto max-w-md pt-10 text-center">
            <span className="nb-tag">New chat</span>
            <p className="mt-3 font-display text-xl font-bold">{emptyTitle}</p>
            <p className="mt-1 text-sm text-stone-600">{emptyHint}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-md border-2 border-ink bg-white px-3 py-2 text-left text-sm font-medium shadow-[2px_2px_0_var(--ink)] transition hover:-translate-x-px hover:-translate-y-px hover:bg-accent-soft hover:shadow-[3px_3px_0_var(--ink)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  notFoundTitle={notFoundTitle}
                  notFoundHint={notFoundHint}
                  onCite={onCite}
                  activeCite={activeCite}
                  focused={m.id === focusedMessageId}
                />
              ),
            )}
            {pending !== null &&
              (pending === "" ? (
                <p className="flex items-center gap-2 text-sm font-medium text-stone-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  {statusText(status, thinking)}
                </p>
              ) : (
                <AssistantMessage message={{ id: "pending", content: pending, sources: [] }} streaming />
              ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border-2 border-ink bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
          <span>{error.message}</span>
          {FIX_IN_SETTINGS.has(error.code) && (
            <Link href="/settings" className="nb-btn nb-btn-sm nb-btn-primary shrink-0">
              Open Settings
            </Link>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="shrink-0 border-t-2 border-ink bg-background p-3"
      >
        {deepCompare && (
          <div className="mb-2 text-xs">
            {/* Two named modes instead of an on/off switch: the text always describes the selected one. */}
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Answer mode">
              <span className="font-display font-bold">Answer mode:</span>
              <button
                type="button"
                role="radio"
                aria-checked={!deepOn}
                disabled={busy}
                onClick={() => setDeepOn(false)}
                className={`nb-btn nb-btn-sm ${!deepOn ? "nb-btn-primary" : ""}`}
              >
                ⚡ Quick
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={deepOn}
                disabled={!deepCompare.available || busy}
                onClick={() => setDeepOn(true)}
                className={`nb-btn nb-btn-sm ${deepOn ? "nb-btn-primary" : ""}`}
              >
                🔍 Deep compare
              </button>
            </div>
            <p className="mt-1.5 text-stone-600">
              {deepOn ? (
                "Reads each paper on its own first, then compares them. More thorough, but slower and uses more AI credits. Switches back to Quick after this question."
              ) : (
                <>
                  {deepCompare.quickHint ??
                    "Good for most questions. Reads all the papers together and answers quickly."}
                  {!deepCompare.available && <span className="block">{deepCompare.reason}</span>}
                </>
              )}
            </p>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-md border-2 border-ink bg-white p-2 shadow-[3px_3px_0_var(--ink)] transition-shadow focus-within:shadow-[3px_3px_0_var(--accent)]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            placeholder="Ask a question…  (Shift+Enter for a new line)"
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="nb-btn nb-btn-sm">
              ■ Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="nb-btn nb-btn-sm nb-btn-primary">
              Send ↵
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmClear}
        danger
        busy={clearing}
        title="Clear this chat?"
        confirmLabel="Clear chat"
        onConfirm={clearChat}
        onCancel={() => setConfirmClear(false)}
      >
        <p>
          All {messages?.length ?? 0} messages in this chat will be permanently deleted. {clearHint} This can&apos;t be
          undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
