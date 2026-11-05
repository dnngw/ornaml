import fs from "node:fs/promises";
import { db, documentPath } from "./db";
import { extractPdf, chunkPages } from "./pdf";
import { embedTexts } from "./ai";
import { toBlob } from "./vectors";
import { embedConfig } from "./settings";
import { describeError } from "./errors";
import { MAX_PAGES, chooseMode, estimateTokens } from "./limits";

const running = (globalThis.__ornamlIngest ??= new Set());

function setStatus(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(
    `UPDATE documents SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @now WHERE id = @id`,
  ).run({ ...fields, id, now: Date.now() });
}

/** Extract, chunk and embed a document. Safe to call fire-and-forget. */
export async function processDocument(id) {
  if (running.has(id)) return;
  running.add(id);
  // Keep updated_at fresh while waiting on rate limits, so the document isn't
  // mistaken for an interrupted one.
  const heartbeat = setInterval(() => {
    db.prepare("UPDATE documents SET updated_at = ? WHERE id = ? AND status = 'processing'").run(Date.now(), id);
  }, 30_000);
  try {
    // progress is machine-readable; the UI turns it into words and a bar.
    setStatus(id, { status: "processing", progress: "extracting", error: null, error_code: null, error_detail: null });

    const data = await fs.readFile(documentPath(id));
    const { numPages, pages } = await extractPdf(data);
    setStatus(id, { num_pages: numPages });
    if (numPages > MAX_PAGES) {
      throw Object.assign(new Error(`PDF has ${numPages} pages (limit ${MAX_PAGES}).`), { code: "too_many_pages" });
    }
    const chunks = chunkPages(pages);

    if (chunks.length === 0) {
      throw Object.assign(new Error("No selectable text found in the PDF."), { code: "no_text" });
    }

    const estTokens = estimateTokens(chunks.reduce((n, c) => n + c.text.length, 0));
    const mode = chooseMode(numPages, estTokens);

    // Full-mode documents are read whole by the chat model: no embeddings needed.
    let vectors = null;
    let embedModel = null;
    if (mode === "search") {
      const cfg = embedConfig();
      embedModel = cfg.model;
      setStatus(id, { progress: `embedding:0/${chunks.length}` });
      vectors = await embedTexts(
        chunks.map((c) => c.text),
        cfg,
        (done, total) => setStatus(id, { progress: `embedding:${done}/${total}` }),
      );
    }

    const insert = db.prepare(
      "INSERT INTO chunks (document_id, idx, page, text, lines, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      db.prepare("DELETE FROM chunks WHERE document_id = ?").run(id);
      chunks.forEach((c, i) => {
        const vec = vectors ? toBlob(vectors[i]) : null;
        insert.run(id, i, c.page, c.text, JSON.stringify(c.lines), vec);
      });
    })();

    setStatus(id, {
      status: "ready",
      progress: null,
      error: null,
      mode,
      est_tokens: estTokens,
      embed_model: embedModel,
    });
  } catch (err) {
    console.error(`[ingest] ${id}:`, err);
    const { code, message } = describeError(err, "embedding");
    setStatus(id, {
      status: "error",
      progress: null,
      error: message,
      error_code: code,
      error_detail: String(err?.message || err).slice(0, 500),
    });
  } finally {
    clearInterval(heartbeat);
    running.delete(id);
  }
}
