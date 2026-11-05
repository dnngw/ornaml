import { db } from "@/lib/db";
import { getDocument, notFound, serializeMessage } from "@/lib/documents";
import { retrieve, buildMessages } from "@/lib/rag";
import { buildCitations, parseAnswer } from "@/lib/answer";
import { describeError } from "@/lib/errors";
import { NDJSON_HEADERS, ndjson, streamModelAnswer } from "@/lib/chat-stream";

// Streams NDJSON events, see lib/chat-stream.js
export async function POST(request, { params }) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return notFound();

  const { question } = await request.json().catch(() => ({}));
  if (!question || !String(question).trim()) {
    return Response.json({ error: "Question is empty" }, { status: 400 });
  }
  if (doc.status !== "ready") {
    return Response.json({ error: "This document is not ready yet." }, { status: 409 });
  }
  const history = db.prepare("SELECT role, content FROM messages WHERE document_id = ? ORDER BY id").all(id);

  let mode, sources;
  try {
    ({ mode, sources } = await retrieve(doc, question));
  } catch (err) {
    if (err.code === "needs_reprocess") {
      // Flag it so the Documents page offers "Try again" for this document.
      db.prepare(
        `UPDATE documents SET status = 'error', error_code = 'needs_reprocess', error_detail = NULL,
           error = 'The embedding settings changed since this long document was prepared. Prepare it again to keep asking questions.',
           updated_at = ? WHERE id = ?`,
      ).run(Date.now(), id);
      return Response.json(
        {
          error:
            'This long document needs to be prepared again (the embedding settings changed). Go to Documents and click "Try again" on it.',
        },
        { status: 409 },
      );
    }
    const problem = describeError(err, "embedding");
    if (problem.code === "missing_key" && err.service === "embedding") {
      problem.message =
        "This document is over 150 pages, so it needs the embedding model to find the relevant parts. Add the embedding API key in Settings.";
    }
    return Response.json({ error: problem.message, code: problem.code }, { status: 502 });
  }

  const now = Date.now();
  const userInfo = db
    .prepare("INSERT INTO messages (document_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
    .run(id, question.trim(), now);
  const userMessage = db.prepare("SELECT * FROM messages WHERE id = ?").get(userInfo.lastInsertRowid);

  const messages = buildMessages({ title: doc.name, mode, sources, history, question: question.trim() });

  const stream = new ReadableStream({
    async start(controller) {
      const out = ndjson(controller);
      out.send({ type: "user", message: serializeMessage(userMessage) });
      const { raw, failure } = await streamModelAnswer({
        messages,
        signal: request.signal,
        out,
        label: `${mode} mode, ${sources.length} sources`,
      });

      const aborted = request.signal.aborted;
      if ((failure && !aborted) || !raw.trim()) {
        // Nothing usable: roll back the question so history stays consistent.
        db.prepare("DELETE FROM messages WHERE id = ?").run(userMessage.id);
        if (!aborted) {
          const problem = failure
            ? describeError(failure, "chat")
            : { message: "The model returned an empty answer. Try again.", code: "unknown" };
          out.send({ type: "error", error: problem.message, code: problem.code, rolledBack: userMessage.id });
        }
        return out.close();
      }

      const { answer, quotes, found } = parseAnswer(raw);
      const citations = buildCitations(answer, quotes, sources);
      const info = db
        .prepare(
          "INSERT INTO messages (document_id, role, content, sources, found, created_at) VALUES (?, 'assistant', ?, ?, ?, ?)",
        )
        .run(
          id,
          answer + (aborted ? "\n\n_(stopped)_" : ""),
          JSON.stringify(citations),
          found === null ? null : found ? 1 : 0,
          Date.now(),
        );
      const saved = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
      if (!aborted) out.send({ type: "done", message: serializeMessage(saved) });
      out.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
