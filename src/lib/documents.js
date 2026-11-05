import { db } from "./db";

// Processing runs in-process and updates `updated_at` as it goes. A document
// that stopped updating was interrupted (e.g. the server was restarted).
const STALE_MS = 3 * 60 * 1000;

function markStale() {
  db.prepare(
    `UPDATE documents SET status = 'error', progress = NULL, error_code = 'interrupted',
       error = 'Processing stopped before it finished (the app was probably closed). Try again.'
     WHERE status = 'processing' AND updated_at < ?`,
  ).run(Date.now() - STALE_MS);
}

export function listDocuments() {
  markStale();
  return db
    .prepare(
      `SELECT d.*,
         (SELECT COUNT(*) FROM messages m WHERE m.document_id = d.id) AS message_count,
         (SELECT json_group_array(c.name) FROM collection_documents cd JOIN collections c ON c.id = cd.collection_id
            WHERE cd.document_id = d.id) AS collection_names,
         (SELECT json_group_array(cd.collection_id) FROM collection_documents cd
            WHERE cd.document_id = d.id) AS collection_ids
       FROM documents d ORDER BY d.created_at DESC`,
    )
    .all()
    .map(({ card, ...d }) => ({
      ...d,
      collection_names: JSON.parse(d.collection_names || "[]"),
      collection_ids: JSON.parse(d.collection_ids || "[]"),
    }));
}

export function getDocument(id) {
  markStale();
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) ?? null;
}

export function notFound() {
  return Response.json({ error: "Document not found" }, { status: 404 });
}

export function serializeMessage(m) {
  return {
    ...m,
    sources: m.sources ? JSON.parse(m.sources) : [],
    found: m.found === null || m.found === undefined ? null : Boolean(m.found),
  };
}
