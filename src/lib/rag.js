import { db } from "./db";
import { embedTexts } from "./ai";
import { embedConfig } from "./settings";
import { cosine, toFloat32 } from "./vectors";
import { chooseMode, estimateTokens } from "./limits";

const TOP_K = 10;
const HISTORY_MESSAGES = 6;

/**
 * How this document is answered. Documents indexed before modes existed have
 * no stored mode, so it's derived from their size the same way ingestion does.
 */
export function documentMode(doc, rows) {
  if (doc.mode === "full" || doc.mode === "search") return doc.mode;
  const chars = rows ? rows.reduce((n, r) => n + r.text.length, 0) : 0;
  return chooseMode(doc.num_pages ?? 0, estimateTokens(chars));
}

/**
 * Pick the chunks the model gets. "full" mode: all of them, in reading order.
 * "search" mode: the TOP_K most similar to the question.
 * @returns {Promise<{ mode: "full" | "search", sources: object[] }>}
 */
export async function retrieve(doc, question) {
  const rows = db
    .prepare("SELECT id, idx, page, text, lines, embedding FROM chunks WHERE document_id = ? ORDER BY idx")
    .all(doc.id);
  const mode = documentMode(doc, rows);
  if (!rows.length) return { mode, sources: [] };

  let picked = rows;
  if (mode === "search") {
    const cfg = embedConfig();
    // Vectors from another model (or none at all) can't be compared with the question.
    if (doc.embed_model !== cfg.model || !rows.some((r) => r.embedding)) {
      throw Object.assign(new Error("Document must be re-embedded for search mode."), { code: "needs_reprocess" });
    }
    const [q] = await embedTexts([question], cfg);
    picked = rows
      .filter((r) => r.embedding)
      .map((r) => ({ r, score: cosine(q, toFloat32(r.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K)
      .map((x) => x.r)
      .sort((a, b) => a.idx - b.idx); // reading order helps the model
  }

  const sources = picked.map((r, i) => ({
    n: i + 1,
    chunkId: r.id,
    page: r.page,
    text: r.text,
    lines: JSON.parse(r.lines),
  }));
  return { mode, sources };
}

const COMMON_RULES = `- PARTIAL: if the sources answer only part of the question, answer that part and say clearly which part isn't covered.
- SMALL TALK: for greetings, thanks or questions about yourself, reply briefly and naturally, without citations.
- LANGUAGE: always reply in the language of the user's latest message, even when the document is in another language.
- CITATIONS: after each claim, cite the supporting source like [S1] or [S2][S5]. Never invent source numbers. Numbers like [12] inside the sources are the paper's own references, not sources.
- Use Markdown (short paragraphs, lists when useful). Be concise but complete.
- QUOTES BLOCK: unless the message is small talk, end your reply with this block. "found" is true if the sources answer the question fully or partly, false if they don't. "quotes" maps every cited source to short verbatim quotes, copied character-for-character from the source text in its original language, max ~25 words each:
<quotes>
{"found": true, "quotes": {"S1": ["exact text from source 1"], "S3": ["exact text from source 3"]}}
</quotes>
Never mention the quotes block in the answer itself.`;

const FULL_PROMPT = (
  title,
) => `You are a careful research assistant. The user is reading a PDF titled "${title}" and asks questions about it. Below is the FULL text of the document, split into numbered sources in reading order.

Rules:
- GROUNDING: answer ONLY from the document. Don't use outside knowledge and never guess numbers, names or results.
- NOT FOUND: if the document doesn't contain the answer, say so clearly. Briefly mention what the document does cover if useful.
${COMMON_RULES}`;

const SEARCH_PROMPT = (
  title,
) => `You are a careful research assistant. The user is reading a PDF titled "${title}" and asks questions about it. It is a long document, so for each question you get numbered excerpts (sources) that a search found. They are NOT the whole document.

Rules:
- GROUNDING: answer ONLY from the sources. Don't use outside knowledge and never guess numbers, names or results.
- NOT FOUND: if the sources don't contain the answer, say you couldn't find it in the passages you were given. Don't claim the document never mentions it (the search may have missed it). Briefly mention what the sources do cover if useful, and suggest rephrasing with terms the document would use or naming a chapter or section.
${COMMON_RULES}`;

const formatSources = (sources) => sources.map((s) => `[S${s.n}] (page ${s.page})\n${s.text}`).join("\n\n");

/**
 * Message layout. In "full" mode the document sits in the system message,
 * which is identical for every question about the same document: DeepSeek's
 * prefix cache then bills it at the much cheaper cache-hit rate.
 */
export function buildMessages({ title, mode, sources, history, question }) {
  const past = history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }));
  if (mode === "full") {
    return [
      { role: "system", content: `${FULL_PROMPT(title)}\n\n=== DOCUMENT ===\n\n${formatSources(sources)}` },
      ...past,
      { role: "user", content: question },
    ];
  }
  return [
    { role: "system", content: SEARCH_PROMPT(title) },
    ...past,
    {
      role: "user",
      content: `Sources from the document:\n\n${formatSources(sources)}\n\n---\nQuestion: ${question}`,
    },
  ];
}
