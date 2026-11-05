import { connection } from "next/server";
import { db } from "@/lib/db";
import { collectionNotFound, getCollection, serializeCollectionMessage } from "@/lib/collections";

export async function GET(_request, { params }) {
  await connection();
  const { id } = await params;
  if (!getCollection(id)) return collectionNotFound();
  const rows = db.prepare("SELECT * FROM collection_messages WHERE collection_id = ? ORDER BY id").all(id);
  return Response.json({ messages: rows.map(serializeCollectionMessage) });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!getCollection(id)) return collectionNotFound();
  db.prepare("DELETE FROM collection_messages WHERE collection_id = ?").run(id);
  return Response.json({ ok: true });
}
