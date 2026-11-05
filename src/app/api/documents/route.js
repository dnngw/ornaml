import fs from "node:fs/promises";
import crypto from "node:crypto";
import { connection } from "next/server";
import { db, documentPath } from "@/lib/db";
import { listDocuments } from "@/lib/documents";
import { processDocument } from "@/lib/ingest";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";

export async function GET() {
  await connection();
  return Response.json({ documents: listDocuments() });
}

export async function POST(request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `The file is larger than ${MAX_UPLOAD_MB} MB.` }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") {
    return Response.json({ error: "That file is not a PDF." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await fs.writeFile(documentPath(id), bytes);
  const now = Date.now();
  db.prepare(
    `INSERT INTO documents (id, name, size, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, 'processing', 'queued', ?, ?)`,
  ).run(id, file.name || "document.pdf", bytes.length, now, now);

  // Runs in the background; the list page polls for status.
  processDocument(id);

  return Response.json({ id }, { status: 201 });
}
