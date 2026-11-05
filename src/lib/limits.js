// Document limits, shared by the browser (pre-upload checks) and the server.
// ornaml is built for papers: most fit in the chat model's context and are
// read whole; long documents fall back to searching the relevant passages.

export const MAX_UPLOAD_MB = 30;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const MAX_PAGES = 300;

// "full": every chunk is sent to the chat model (no embeddings needed).
// "search": embeddings pick the most relevant chunks for each question.
export const FULL_DOC_MAX_PAGES = 150;
// Safety net for unusually dense PDFs, so cost and context stay reasonable.
export const FULL_DOC_MAX_TOKENS = 150_000;

// Collections (multi-paper chat)
export const MAX_COLLECTION_PAPERS = 20;
export const DEEP_COMPARE_MAX_PAPERS = 10;
// Collections whose papers together fit this budget are read whole; larger
// ones use paper summaries plus the most relevant chunks of each paper.
export const COLLECTION_FULL_MAX_TOKENS = 150_000;

/** Rough token count (~4 characters per token for English text). */
export function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

/** Long documents are answered from searched passages; the UI tells the user so. */
export function isLongDocument(doc) {
  if (doc?.mode) return doc.mode === "search";
  return (doc?.num_pages ?? 0) > FULL_DOC_MAX_PAGES; // documents indexed before modes existed
}

export function chooseMode(numPages, estTokens) {
  return numPages <= FULL_DOC_MAX_PAGES && estTokens <= FULL_DOC_MAX_TOKENS ? "full" : "search";
}
