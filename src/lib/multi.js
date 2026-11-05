// Answering questions across the papers of a collection.
//
//  1. "full"   – small collections: every paper is sent whole.
//  2. "search" – large collections: a card (summary) of every paper plus the
//                most relevant chunks of EACH paper, so none is left out.
//  3. "deep"   – optional, chosen by the user: each paper is read whole on its
//                own, then the notes are combined into one answer.

import { db } from "./db";
import { embedTexts, streamChat } from "./ai";
import { embedConfig, chatConfig } from "./settings";
import { CITE_RE } from "./cite";
import { cosine, toFloat32 } from "./vectors";
import { pool } from "./async";
import { documentMode } from "./rag";
import { parseAnswer } from "./answer";
import { collectionStrategy } from "./collections";
import { ensureCard, ensureEmbedded, needsEmbedding } from "./prepare";

const HISTORY_MESSAGES = 6;
const SEARCH_CHUNK_BUDGET = 30; // chunks per question in "search" strategy
const SEARCH_MIN_PER_PAPER = 2;
const SEARCH_EXTRA_BEST = 10; // extra chunks for the best matches overall
const DEEP_CONCURRENCY = 3;
const DEEP_LONG_DOC_CHUNKS = 15; // long papers (search mode) in deep compare

function loadChunks(docId) {
  return db
    .prepare("SELECT id, idx, page, text, lines, embedding FROM chunks WHERE document_id = ? ORDER BY idx")
    .all(docId);
}

const toSource = (doc, r) => ({
  docId: doc.id,
  docName: doc.name,
  chunkId: r.id,
  idx: r.idx,
  page: r.page,
  text: r.text,
  lines: JSON.parse(r.lines),
});
const number = (sources) => sources.map((s, i) => ({ ...s, n: i + 1 }));

function cardText(doc, card) {
  if (!card) return `${doc.name}: (no summary available)`;
  const f = (k, label) => (card[k] ? `${label}: ${card[k]}` : null);
  return [
    `${doc.name}${card.title ? ` — "${card.title}"` : ""}${card.authors ? `, ${card.authors}` : ""}${card.year ? ` (${card.year})` : ""}`,
    f("topic", "Topic"),
    f("methods", "Methods"),
    f("data", "Data"),
    f("findings", "Findings"),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pick what the model gets for a question in this collection.
 * onStatus({ kind: "preparing", count }) fires when papers must be embedded first.
 */
export async function retrieveCollection(docs, question, { onStatus } = {}) {
  const ready = docs.filter((d) => d.status === "ready");
  const { strategy } = collectionStrategy(ready);

  if (strategy === "full") {
    const sources = ready.flatMap((doc) => loadChunks(doc.id).map((r) => toSource(doc, r)));
    return { strategy, sources: number(sources), cards: [] };
  }

  // "search": embeddings + cards for every paper (made once, then reused).
  const unprepared = ready.filter((d) => needsEmbedding(d));
  if (unprepared.length) onStatus?.({ kind: "preparing", count: unprepared.length });
  for (const doc of unprepared) await ensureEmbedded(doc);
  const cards = await Promise.all(ready.map((d) => ensureCard(d).catch(() => null)));

  const [q] = await embedTexts([question], embedConfig());
  const perPaper = Math.max(SEARCH_MIN_PER_PAPER, Math.floor(SEARCH_CHUNK_BUDGET / ready.length));
  const scored = ready.map((doc) =>
    loadChunks(doc.id)
      .filter((r) => r.embedding)
      .map((r) => ({ doc, r, score: cosine(q, toFloat32(r.embedding)) }))
      .sort((a, b) => b.score - a.score),
  );
  const picked = new Map(); // chunk id -> entry
  for (const list of scored) for (const x of list.slice(0, perPaper)) picked.set(x.r.id, x);
  const rest = scored.flatMap((list) => list.slice(perPaper)).sort((a, b) => b.score - a.score);
  for (const x of rest.slice(0, SEARCH_EXTRA_BEST)) picked.set(x.r.id, x);

  // Group by paper (collection order), then reading order inside each paper.
  const order = new Map(ready.map((d, i) => [d.id, i]));
  const sources = [...picked.values()]
    .sort((a, b) => order.get(a.doc.id) - order.get(b.doc.id) || a.r.idx - b.r.idx)
    .map((x) => toSource(x.doc, x.r));
  return { strategy, sources: number(sources), cards: ready.map((d, i) => cardText(d, cards[i])) };
}

function formatGrouped(sources) {
  let out = "";
  let current = null;
  for (const s of sources) {
    if (s.docId !== current) {
      current = s.docId;
      out += `\n=== Paper: ${s.docName} ===\n\n`;
    }
    out += `[S${s.n}] (page ${s.page})\n${s.text}\n\n`;
  }
  return out.trim();
}

const COMMON_RULES = `- PAPERS: always make clear which paper each statement comes from (use the file name or the paper's short name). When comparing, cover every paper the question is about.
- PARTIAL: if only some papers answer the question, say which ones do and which don't.
- SMALL TALK: for greetings, thanks or questions about yourself, reply briefly and naturally, without citations.
- LANGUAGE: always reply in the language of the user's latest message, even when the papers are in another language.
- CITATIONS: after each claim, cite the supporting source like [S1] or [S2][S5]. Never invent source numbers. Numbers like [12] inside the sources are the papers' own references, not sources.
- Use Markdown (short paragraphs, lists or a table when comparing). Be concise but complete.
- QUOTES BLOCK: unless the message is small talk, end your reply with this block. "found" is true if the sources answer the question fully or partly, false if they don't. "quotes" maps every cited source to short verbatim quotes, copied character-for-character from the source text in its original language, max ~25 words each:
<quotes>
{"found": true, "quotes": {"S1": ["exact text from source 1"], "S3": ["exact text from source 3"]}}
</quotes>
Never mention the quotes block in the answer itself.`;

const FULL_PROMPT = (
  name,
  n,
) => `You are a careful research assistant. The user is studying a collection of ${n} papers called "${name}" and asks questions across them. Below is the FULL text of every paper, split into numbered sources and grouped by paper.

Rules:
- GROUNDING: answer ONLY from the papers. Don't use outside knowledge and never guess numbers, names or results.
- NOT FOUND: if none of the papers contains the answer, say so clearly.
${COMMON_RULES}`;

const SEARCH_PROMPT = (
  name,
  n,
) => `You are a careful research assistant. The user is studying a collection of ${n} papers called "${name}" and asks questions across them. It is a large collection, so you get (1) a short summary card of EVERY paper and (2) numbered excerpts (sources) that a search found in each paper. The excerpts are NOT the whole papers.

Rules:
- GROUNDING: answer ONLY from the cards and sources. Don't use outside knowledge and never guess numbers, names or results. Cards give an overview but can't be cited; cite sources.
- NOT FOUND: if the cards and sources don't contain the answer, say you couldn't find it in the parts you were given (the search may have missed it), and suggest rephrasing or choosing "Deep compare" as the answer mode (below the chat box).
${COMMON_RULES}`;

const pastMessages = (history) => history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }));

/** Message layout; the collection's papers sit in the system message so it stays cacheable. */
export function buildCollectionMessages({ name, strategy, sources, cards, history, question, paperCount }) {
  if (strategy === "full") {
    return [
      { role: "system", content: `${FULL_PROMPT(name, paperCount)}\n\n${formatGrouped(sources)}` },
      ...pastMessages(history),
      { role: "user", content: question },
    ];
  }
  return [
    {
      role: "system",
      content: `${SEARCH_PROMPT(name, paperCount)}\n\n=== PAPER CARDS ===\n\n${cards.join("\n\n")}`,
    },
    ...pastMessages(history),
    {
      role: "user",
      content: `Sources found in the papers:\n\n${formatGrouped(sources)}\n\n---\nQuestion: ${question}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Deep compare
// ---------------------------------------------------------------------------

const PAPER_NOTES_PROMPT = (
  docName,
) => `You are helping compare several papers. Right now you read ONE of them: "${docName}" (full text below, split into numbered sources). Write short notes with everything in THIS paper that is relevant to the user's question, so they can be compared with notes from the other papers later.

Rules:
- The question may mention several papers or ask for a comparison. Only report what THIS paper says; the other papers are read separately. Never comment on other papers being missing.
- Use only this paper. Never guess numbers, names or results.
- Cite every point like [S3]. Never invent source numbers.
- Be specific (numbers, names, settings) but brief: at most ~200 words, as bullet points.
- If the paper has nothing relevant, write exactly: NOTHING RELEVANT
- Write the notes in English.
- End with this block, mapping every cited source to short verbatim quotes (character-for-character, max ~25 words each):
<quotes>
{"found": true, "quotes": {"S1": ["exact text from source 1"]}}
</quotes>`;

const DEEP_FINAL_PROMPT = (
  name,
  n,
) => `You are a careful research assistant. The user is studying a collection of ${n} papers called "${name}". Each paper was read in full, and notes relevant to the question were taken from each one (below). Write the final answer from these notes.

Rules:
- Use ONLY the notes. Don't add facts that aren't in them.
- Cover every paper the question is about, and make clear which paper each statement comes from. A table often helps for comparisons.
- Keep the citations from the notes exactly as they are ([S4], [S12] …): cite them after each claim. Never invent source numbers.
- If a paper had nothing relevant, say so briefly.
- LANGUAGE: reply in the language of the user's latest message.
- Use Markdown. Be concise but complete.
- End with this block; "found" is true if the notes answer the question fully or partly:
<quotes>
{"found": true, "quotes": {}}
</quotes>
Never mention the block in the answer itself.`;

async function collect(messages, signal, label) {
  let out = "";
  for await (const d of streamChat(messages, chatConfig(), { signal })) {
    if (d.kind === "content") out += d.text;
    if (d.kind === "usage") {
      const u = d.usage;
      const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
      console.info(`[chat] ${label} · tokens in=${u.prompt_tokens} (cached ${cached}) out=${u.completion_tokens}`);
    }
  }
  return out;
}

/** Chunks a paper contributes to deep compare: all of it, or the best part of a long paper. */
async function deepPaperSources(doc, question) {
  const rows = loadChunks(doc.id);
  if (documentMode(doc, rows) === "full") return rows.map((r) => toSource(doc, r));
  await ensureEmbedded(doc);
  const [q] = await embedTexts([question], embedConfig());
  return loadChunks(doc.id)
    .filter((r) => r.embedding)
    .map((r) => ({ r, score: cosine(q, toFloat32(r.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DEEP_LONG_DOC_CHUNKS)
    .map((x) => x.r)
    .sort((a, b) => a.idx - b.idx)
    .map((r) => toSource(doc, r));
}

/**
 * Read each paper on its own, then return the messages for the final answer,
 * the global source list and quotes (citations keep pointing at real chunks).
 * onStatus({ kind: "reading", index, total, name }) / ({ kind: "comparing" }).
 */
export async function prepareDeepCompare({ name, docs, question, history, onStatus, signal }) {
  const ready = docs.filter((d) => d.status === "ready");
  let done = 0;
  onStatus?.({ kind: "reading", index: 0, total: ready.length });
  const perPaper = await pool(ready, DEEP_CONCURRENCY, async (doc) => {
    const local = number(await deepPaperSources(doc, question));
    const body = local.map((s) => `[S${s.n}] (page ${s.page})\n${s.text}`).join("\n\n");
    const raw = await collect(
      [
        { role: "system", content: `${PAPER_NOTES_PROMPT(doc.name)}\n\n=== PAPER ===\n\n${body}` },
        { role: "user", content: question },
      ],
      signal,
      `deep compare notes: ${doc.name}`,
    );
    done += 1;
    onStatus?.({ kind: "reading", index: done, total: ready.length, name: doc.name });
    return { doc, local, ...parseAnswer(raw) };
  });

  // Renumber each paper's citations into one global list.
  const sources = [];
  const quotes = {};
  const noteBlocks = perPaper.map(({ doc, local, answer, quotes: q }) => {
    const map = new Map();
    const notes = answer.replace(CITE_RE, (_, inner) =>
      inner
        .match(/\d+/g)
        .map((n) => {
          const src = local[Number(n) - 1];
          if (!src) return "";
          if (!map.has(src.n)) {
            const g = sources.length + 1;
            map.set(src.n, g);
            sources.push({ ...src, n: g });
            quotes[`S${g}`] = q[`S${src.n}`] || q[String(src.n)] || [];
          }
          return `[S${map.get(src.n)}]`;
        })
        .join(""),
    );
    return `=== Notes from: ${doc.name} ===\n${/NOTHING RELEVANT/.test(notes) ? "Nothing relevant to the question." : notes}`;
  });

  onStatus?.({ kind: "comparing" });
  const messages = [
    { role: "system", content: DEEP_FINAL_PROMPT(name, ready.length) },
    ...pastMessages(history),
    { role: "user", content: `${noteBlocks.join("\n\n")}\n\n---\nQuestion: ${question}` },
  ];
  return { messages, sources, quotes, papersRead: ready.length };
}
