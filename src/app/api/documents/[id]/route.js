import fs from "node:fs/promises";
import { connection } from "next/server";
import { db, documentPath } from "@/lib/db";
import { getDocument, notFound } from "@/lib/documents";

export async function GET(_request, { params }) {
  await connection();
  const { id } = await params;
  const doc = getDocument(id);
  return doc ? Response.json({ document: doc }) : notFound();
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!getDocument(id)) return notFound();
  db.prepare("DELETE FROM documents WHERE id = ?").run(id); // chunks + messages cascade
  await fs.rm(documentPath(id), { force: true });
  return Response.json({ ok: true });
}
