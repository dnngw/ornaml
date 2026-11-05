// Vector helpers for embeddings stored as Float32 BLOBs in SQLite.

/** Cosine similarity of two equal-length vectors (0 when either is all zeros). */
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** View a SQLite BLOB (Node Buffer) as a Float32Array without copying. */
export function toFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Serialize a vector for storage. */
export function toBlob(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}
