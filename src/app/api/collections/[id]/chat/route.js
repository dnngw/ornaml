import { db } from "@/lib/db";
import { collectionDocuments, collectionNotFound, getCollection, serializeCollectionMessage } from "@/lib/collections";
import { buildCollectionMessages, prepareDeepCompare, retrieveCollection } from "@/lib/multi";
import { buildCitations, parseAnswer } from "@/lib/answer";
import { describeError } from "@/lib/errors";
import { DEEP_COMPARE_MAX_PAPERS } from "@/lib/limits";
import { NDJSON_HEADERS, ndjson, streamModelAnswer } from "@/lib/chat-stream";

// Body: { question, deep? }. Streams NDJSON events, see lib/chat-stream.js.
export async function POST(request, { params }) {
  const { id } = await params;
  const collection = getCollection(id);
  if (!collection) return collectionNotFound();

  const { question, deep } = await request.json().catch(() => ({}));
  const q = String(question ?? "").trim();
  if (!q) return Response.json({ error: "Question is empty" }, { status: 400 });

  const docs = collectionDocuments(id);
  const ready = docs.filter((d) => d.status === "ready");
  if (!ready.length) {
    return Response.json(
      {
        error: docs.length
          ? "The papers in this collection are still being prepared."
          : "Add papers to this collection first.",
      },
      { status: 409 },
    );
  }
  if (deep && ready.length < 2) {
    return Response.json({ error: "Deep compare needs at least 2 papers in the collection." }, { status: 400 });
  }
  if (deep && ready.length > DEEP_COMPARE_MAX_PAPERS) {
    return Response.json(
      {
        error: `Deep compare works with up to ${DEEP_COMPARE_MAX_PAPERS} papers, and this collection has ${ready.length}.`,
      },
      { status: 400 },
    );
  }

  const history = db
    .prepare("SELECT role, content FROM collection_messages WHERE collection_id = ? ORDER BY id")
    .all(id);
  const userInfo = db
    .prepare("INSERT INTO collection_messages (collection_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
    .run(id, q, Date.now());
  const userMessage = db.prepare("SELECT * FROM collection_messages WHERE id = ?").get(userInfo.lastInsertRowid);
  db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(Date.now(), id);

  const stream = new ReadableStream({
    async start(controller) {
      const out = ndjson(controller);
      out.send({ type: "user", message: serializeCollectionMessage(userMessage) });
      // Undo the question and tell the browser why ({ message, code } from describeError), or nothing if aborted.
      const rollback = (problem) => {
        db.prepare("DELETE FROM collection_messages WHERE id = ?").run(userMessage.id);
        if (problem)
          out.send({ type: "error", error: problem.message, code: problem.code, rolledBack: userMessage.id });
        out.close();
      };
      const onStatus = (s) => out.send({ type: "status", ...s });

      // Gather what the model reads (may take a while: deep compare reads every paper).
      let strategy,
        messages,
        sources,
        deepQuotes = null,
        papersRead = null;
      try {
        if (deep) {
          const prep = await prepareDeepCompare({
            name: collection.name,
            docs,
            question: q,
            history,
            onStatus,
            signal: request.signal,
          });
          ({ messages, sources, papersRead } = prep);
          deepQuotes = prep.quotes;
          strategy = "deep";
        } else {
          const r = await retrieveCollection(docs, q, { onStatus });
          strategy = r.strategy;
          sources = r.sources;
          messages = buildCollectionMessages({
            name: collection.name,
            strategy,
            sources,
            cards: r.cards,
            history,
            question: q,
            paperCount: ready.length,
          });
        }
      } catch (err) {
        if (request.signal.aborted) return rollback(null);
        console.error(`[collection chat] ${id}:`, err);
        const problem = describeError(err, deep ? "chat" : "embedding");
        if (problem.code === "missing_key" && err.service === "embedding") {
          // Which feature needs the key, in words the user can act on.
          problem.message = deep
            ? "One of these papers is over 150 pages, so it needs the embedding model to find its relevant parts. Add the embedding API key in Settings, or remove that paper from the collection."
            : "This collection is large, so it needs the embedding model to find the relevant parts of each paper. Add the embedding API key in Settings, or use Deep compare.";
        }
        return rollback(problem);
      }

      const { raw, failure } = await streamModelAnswer({
        messages,
        signal: request.signal,
        out,
        label: `collection ${strategy}, ${ready.length} papers, ${sources.length} sources`,
      });
      const aborted = request.signal.aborted;
      if ((failure && !aborted) || !raw.trim()) {
        return rollback(
          aborted
            ? null
            : failure
              ? describeError(failure, "chat")
              : { message: "The model returned an empty answer. Try again.", code: "unknown" },
        );
      }

      const { answer, quotes, found } = parseAnswer(raw);
      const citations = buildCitations(answer, deepQuotes ?? quotes, sources);
      const info = db
        .prepare(
          `INSERT INTO collection_messages (collection_id, role, content, sources, found, strategy, papers_read, created_at)
           VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          answer + (aborted ? "\n\n_(stopped)_" : ""),
          JSON.stringify(citations),
          found === null ? null : found ? 1 : 0,
          strategy,
          papersRead,
          Date.now(),
        );
      const saved = db.prepare("SELECT * FROM collection_messages WHERE id = ?").get(info.lastInsertRowid);
      if (!aborted) out.send({ type: "done", message: serializeCollectionMessage(saved) });
      out.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
