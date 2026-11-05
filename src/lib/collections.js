import crypto from "node:crypto";
import { db } from "./db";
import { COLLECTION_FULL_MAX_TOKENS, MAX_COLLECTION_PAPERS, estimateTokens } from "./limits";

export class CollectionError extends Error {}

export function collectionNotFound() {
  return Response.json({ error: "Collection not found" }, { status: 404 });
}

export function listCollections() {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM collection_documents cd WHERE cd.collection_id = c.id) AS paper_count,
         (SELECT COUNT(*) FROM collection_messages m WHERE m.collection_id = c.id) AS message_count
       FROM collections c ORDER BY c.updated_at DESC`,
    )
    .all();
  const names = db.prepare(
    `SELECT d.name FROM collection_documents cd JOIN documents d ON d.id = cd.document_id
     WHERE cd.collection_id = ? ORDER BY cd.added_at, d.name`,
  );
  return rows.map((c) => ({ ...c, paper_names: names.all(c.id).map((r) => r.name) }));
}

/** Member documents in a stable order (stable order keeps the prompt prefix cacheable). */
export function collectionDocuments(collectionId) {
  return db
    .prepare(
      `SELECT d.* FROM collection_documents cd JOIN documents d ON d.id = cd.document_id
       WHERE cd.collection_id = ? ORDER BY cd.added_at, d.id`,
    )
    .all(collectionId);
}

export function getCollection(id) {
  return db.prepare("SELECT * FROM collections WHERE id = ?").get(id) ?? null;
}

/** Estimated tokens per document (older documents have no stored estimate). */
export function documentTokens(docs) {
  const missing = docs.filter((d) => d.est_tokens == null).map((d) => d.id);
  const computed = new Map();
  if (missing.length) {
    const q = db.prepare("SELECT SUM(LENGTH(text)) AS chars FROM chunks WHERE document_id = ?");
    for (const id of missing) computed.set(id, estimateTokens(q.get(id)?.chars ?? 0));
  }
  return new Map(docs.map((d) => [d.id, d.est_tokens ?? computed.get(d.id) ?? 0]));
}

/**
 * How questions in this collection are answered:
 *  - "full": every ready paper is sent whole (small collections)
 *  - "search": paper summaries + the most relevant chunks of each paper
 * Deep compare is chosen per question by the user, on top of this.
 */
export function collectionStrategy(docs) {
  const ready = docs.filter((d) => d.status === "ready");
  const tokens = documentTokens(ready);
  const total = ready.reduce((n, d) => n + tokens.get(d.id), 0);
  return { strategy: total <= COLLECTION_FULL_MAX_TOKENS ? "full" : "search", totalTokens: total };
}

function validateName(name) {
  const n = String(name ?? "").trim();
  if (!n) throw new CollectionError("Give the collection a name.");
  if (n.length > 80) throw new CollectionError("Collection names can be at most 80 characters.");
  return n;
}

function setMembers(collectionId, documentIds) {
  const ids = [...new Set(documentIds || [])];
  if (ids.length > MAX_COLLECTION_PAPERS) {
    throw new CollectionError(`A collection can hold up to ${MAX_COLLECTION_PAPERS} papers.`);
  }
  const exists = db.prepare("SELECT 1 FROM documents WHERE id = ?");
  for (const id of ids) if (!exists.get(id)) throw new CollectionError("One of the selected papers no longer exists.");

  const current = new Set(
    db
      .prepare("SELECT document_id FROM collection_documents WHERE collection_id = ?")
      .all(collectionId)
      .map((r) => r.document_id),
  );
  const now = Date.now();
  const add = db.prepare(
    "INSERT OR IGNORE INTO collection_documents (collection_id, document_id, added_at) VALUES (?, ?, ?)",
  );
  const remove = db.prepare("DELETE FROM collection_documents WHERE collection_id = ? AND document_id = ?");
  ids.forEach((id, i) => current.has(id) || add.run(collectionId, id, now + i));
  for (const id of current) if (!ids.includes(id)) remove.run(collectionId, id);
}

export function createCollection({ name, documentIds = [] }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.transaction(() => {
    db.prepare("INSERT INTO collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      id,
      validateName(name),
      now,
      now,
    );
    setMembers(id, documentIds);
  })();
  return id;
}

/** Rename and/or replace the member list, or add papers to what's there. */
export function updateCollection(id, { name, documentIds, addDocumentIds }) {
  db.transaction(() => {
    if (name !== undefined) db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(validateName(name), id);
    if (documentIds !== undefined) setMembers(id, documentIds);
    if (addDocumentIds !== undefined) {
      const current = collectionDocuments(id).map((d) => d.id);
      setMembers(id, [...current, ...addDocumentIds]);
    }
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  })();
}

export function deleteCollection(id) {
  db.prepare("DELETE FROM collections WHERE id = ?").run(id); // members + messages cascade
}

export function serializeCollectionMessage(m) {
  return {
    ...m,
    sources: m.sources ? JSON.parse(m.sources) : [],
    found: m.found === null || m.found === undefined ? null : Boolean(m.found),
  };
}
