import { connection } from "next/server";
import { db } from "@/lib/db";
import { getDocument, notFound, serializeMessage } from "@/lib/documents";

export async function GET(_request, { params }) {
  await connection();
  const { id } = await params;
  if (!getDocument(id)) return notFound();
  const rows = db.prepare("SELECT * FROM messages WHERE document_id = ? ORDER BY id").all(id);
  return Response.json({ messages: rows.map(serializeMessage) });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!getDocument(id)) return notFound();
  db.prepare("DELETE FROM messages WHERE document_id = ?").run(id);
  return Response.json({ ok: true });
}
