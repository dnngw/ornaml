// On-demand preparation for large collections: embeddings (papers up to 150
// pages aren't embedded at upload) and short "paper cards" (summaries).
// Both are made once, stored, and reused by every collection.

import { db } from "./db";
import { embedTexts, streamChat } from "./ai";
import { toBlob } from "./vectors";
import { chatConfig, embedConfig } from "./settings";
import { collectionDocuments, collectionStrategy } from "./collections";

// One job per document at a time, shared by background prep and questions.
const jobs = (globalThis.__ornamlPrepJobs ??= new Map());
function once(key, fn) {
  if (!jobs.has(key))
    jobs.set(
      key,
      fn().finally(() => jobs.delete(key)),
    );
  return jobs.get(key);
}

export function needsEmbedding(doc) {
  if (doc.embed_model !== embedConfig().model) return true;
  const missing = db
    .prepare("SELECT COUNT(*) AS n FROM chunks WHERE document_id = ? AND embedding IS NULL")
    .get(doc.id).n;
  return missing > 0;
}

/** Embed every chunk of a document with the current embedding model (if not done yet). */
export function ensureEmbedded(doc) {
  return once(`embed:${doc.id}`, async () => {
    const fresh = db.prepare("SELECT * FROM documents WHERE id = ?").get(doc.id);
    if (!fresh || !needsEmbedding(fresh)) return;
    const cfg = embedConfig();
    const chunks = db.prepare("SELECT id, text FROM chunks WHERE document_id = ? ORDER BY idx").all(doc.id);
    const vectors = await embedTexts(
      chunks.map((c) => c.text),
      cfg,
    );
    const update = db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?");
    db.transaction(() => {
      chunks.forEach((c, i) => update.run(toBlob(vectors[i]), c.id));
      db.prepare("UPDATE documents SET embed_model = ? WHERE id = ?").run(cfg.model, doc.id);
    })();
  });
}

const CARD_PROMPT = `You summarize research papers for a reading tool. From the excerpt (the beginning and the end of a paper), fill in this JSON. Be concise (about 120 words in total), write in English, use null when something isn't stated. Output ONLY the JSON, no code fences.
{"title": "...", "authors": "First author et al.", "year": "...", "topic": "one sentence", "methods": "...", "data": "datasets or materials", "findings": "main results"}`;

const CARD_FIELDS = ["title", "authors", "year", "topic", "methods", "data", "findings"];

/** Parse the model's card; throws if it isn't a usable card (it's then retried next time). */
function parseCard(text) {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const card = JSON.parse(json);
  if (!card || typeof card !== "object" || !CARD_FIELDS.some((k) => typeof card[k] === "string")) {
    throw new Error("The model didn't return a paper summary.");
  }
  return Object.fromEntries(CARD_FIELDS.map((k) => [k, typeof card[k] === "string" ? card[k] : null]));
}

/** A short summary of a paper, made once by the chat model and stored. */
export function ensureCard(doc) {
  return once(`card:${doc.id}`, async () => {
    const fresh = db.prepare("SELECT card FROM documents WHERE id = ?").get(doc.id);
    if (fresh?.card) return JSON.parse(fresh.card);
    const chunks = db.prepare("SELECT text FROM chunks WHERE document_id = ? ORDER BY idx").all(doc.id);
    const all = chunks.map((c) => c.text).join("\n");
    const excerpt = all.length > 16000 ? `${all.slice(0, 12000)}\n[…]\n${all.slice(-4000)}` : all;

    let out = "";
    for await (const d of streamChat(
      [
        { role: "system", content: CARD_PROMPT },
        { role: "user", content: `File: ${doc.name}\n\n${excerpt}` },
      ],
      chatConfig(),
    )) {
      if (d.kind === "content") out += d.text;
    }
    const card = parseCard(out);
    db.prepare("UPDATE documents SET card = ? WHERE id = ?").run(JSON.stringify(card), doc.id);
    return card;
  });
}

/**
 * Background warm-up after a collection's papers change: if it is large
 * ("search" strategy), embed its papers and make their cards before the user
 * asks, so the first question rarely has to wait. Failures are left for the
 * chat to report in plain words.
 */
export function prepareCollection(collectionId) {
  const docs = collectionDocuments(collectionId).filter((d) => d.status === "ready");
  if (collectionStrategy(docs).strategy !== "search") return;
  (async () => {
    for (const doc of docs) {
      try {
        await ensureEmbedded(doc);
        await ensureCard(doc);
      } catch (err) {
        console.warn(`[prepare] ${doc.name}: ${err.message}`);
      }
    }
  })();
}
