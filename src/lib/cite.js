// Shared by server and client. Matches [S1], [S1, S3], [S1,3].
export const CITE_RE = /\[(S\d+(?:\s*,\s*S?\d+)*)\]/g;

/**
 * Display numbers for citations: 1, 2, 3… in order of first appearance in the
 * answer. Internally sources keep their chunk number (S42); users only see the
 * per-answer number. Returns Map<sourceNumber, label>.
 */
export function citationLabels(text) {
  const labels = new Map();
  for (const m of String(text || "").matchAll(CITE_RE)) {
    for (const n of m[1].match(/\d+/g)) {
      const num = Number(n);
      if (!labels.has(num)) labels.set(num, labels.size + 1);
    }
  }
  return labels;
}

/** Sources with a `label`, ordered as they're first cited in the answer. */
export function labeledSources(message) {
  const labels = citationLabels(message?.content);
  const sources = (message?.sources || []).map((s) => ({ ...s, label: labels.get(s.n) ?? labels.size + 1 }));
  return sources.sort((a, b) => a.label - b.label);
}
