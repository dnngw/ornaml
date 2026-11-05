// Turning the model's raw output into what is stored and shown: the visible
// answer, the "found" flag, and citations with rectangles to highlight.
// Pure functions (no database), shared by the paper and collection chats.

import { matchQuote } from "./match";
import { CITE_RE } from "./cite";

/**
 * Split the model output into the visible answer, the quotes map and the
 * "found" flag (true/false, or null when the model sent no block, e.g. small talk).
 */
export function parseAnswer(raw) {
  const start = raw.indexOf("<quotes>");
  if (start < 0) return { answer: raw.trim(), quotes: {}, found: null };
  const answer = raw.slice(0, start).trim();
  const end = raw.indexOf("</quotes>", start);
  const body = raw.slice(start + 8, end < 0 ? undefined : end).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(body.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {}
  if (!parsed || typeof parsed !== "object") return { answer, quotes: {}, found: null };
  // Current format: { found, quotes: {...} }. Older format: the quotes map itself.
  if ("found" in parsed || "quotes" in parsed) {
    return {
      answer,
      quotes: parsed.quotes && typeof parsed.quotes === "object" ? parsed.quotes : {},
      found: typeof parsed.found === "boolean" ? parsed.found : null,
    };
  }
  return { answer, quotes: parsed, found: null };
}

/**
 * Build the citation list stored with an assistant message: one entry per
 * cited source, with rectangles to highlight on its page.
 */
export function buildCitations(answer, quotes, sources) {
  const cited = new Set();
  for (const m of answer.matchAll(CITE_RE)) for (const n of m[1].match(/\d+/g)) cited.add(Number(n));
  return sources
    .filter((s) => cited.has(s.n))
    .map((s) => {
      const qs = [].concat(quotes[`S${s.n}`] || quotes[String(s.n)] || []).filter((q) => typeof q === "string");
      const lineIdx = new Set();
      for (const q of qs) for (const i of matchQuote(s.lines, q)) lineIdx.add(i);
      const exact = lineIdx.size > 0;
      // Without a matching quote, highlight the whole chunk.
      const idxs = exact ? [...lineIdx].sort((a, b) => a - b) : s.lines.map((_, i) => i);
      return {
        n: s.n,
        ...(s.docId && { docId: s.docId, docName: s.docName }), // collections
        page: s.page,
        exact,
        quote: qs[0] || "",
        excerpt: s.text.slice(0, 300),
        rects: idxs.map((i) => s.lines[i].r),
      };
    });
}
