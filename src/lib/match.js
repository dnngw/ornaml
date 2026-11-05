// Map a verbatim quote from the LLM back to the PDF lines it came from.

function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents left by NFKD
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(s) {
  return norm(s)
    .split(" ")
    .filter((w) => w.length > 2);
}

/**
 * Find the line indexes in `lines` that contain `quote`.
 * Tries an exact (normalized) substring match first, then falls back to
 * word overlap so slightly paraphrased quotes still land somewhere sensible.
 * @returns {number[]} matching line indexes (may be empty)
 */
export function matchQuote(lines, quote) {
  const q = norm(quote);
  if (!q) return [];

  // Build one normalized string with per-line offsets; join hyphenated words.
  let joined = "";
  const spans = [];
  lines.forEach((l, i) => {
    let t = l.t;
    const hyphen = /[a-zA-Z]-$/.test(t) && i < lines.length - 1;
    if (hyphen) t = t.slice(0, -1);
    const n = norm(t);
    const start = joined.length;
    joined += n;
    spans.push([start, joined.length]);
    if (!hyphen) joined += " ";
  });

  const hit = (from, to) => spans.map(([s, e], i) => (e > from && s < to ? i : -1)).filter((i) => i >= 0);

  const exact = joined.indexOf(q);
  if (exact >= 0) return hit(exact, exact + q.length);

  // Quotes are sometimes truncated or lightly edited: try a long prefix and suffix.
  if (q.length > 40) {
    const head = joined.indexOf(q.slice(0, 40));
    const tail = joined.indexOf(q.slice(-40));
    if (head >= 0 && tail >= head) return hit(head, tail + 40);
    if (head >= 0) return hit(head, head + q.length);
    if (tail >= 0) return hit(tail + 40 - q.length, tail + 40);
  }

  // Fallback: word overlap per line, keep the best contiguous run.
  const qset = new Set(tokens(quote));
  if (qset.size < 3) return [];
  const scores = lines.map((l) => {
    const lt = tokens(l.t);
    if (!lt.length) return 0;
    return lt.filter((w) => qset.has(w)).length / lt.length;
  });
  let best = [];
  let run = [];
  scores.forEach((s, i) => {
    if (s >= 0.6) run.push(i);
    else run = [];
    if (run.length > best.length) best = [...run];
  });
  return best;
}
