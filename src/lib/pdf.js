// Server-side PDF text extraction with line-level positions.
// Every line keeps a bounding box (normalized 0..1 relative to the page),
// which is what lets the viewer highlight cited lines later.

const CHUNK_TARGET_CHARS = 1000;
const CHUNK_OVERLAP_LINES = 2;

async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * Extract lines (text + bbox) for every page.
 * @returns {Promise<{ numPages: number, pages: { page: number, lines: { t: string, r: number[] }[] }[] }>}
 */
export async function extractPdf(data) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ page: p, lines: itemsToLines(content.items, viewport, pdfjs.Util) });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { numPages: pages.length, pages };
}

function itemsToLines(items, viewport, Util) {
  const lines = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.text.trim()) lines.push(cur);
    cur = null;
  };

  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const str = it.str;

    const tx = Util.transform(viewport.transform, it.transform);
    // Skip rotated text (e.g. the vertical arXiv stamp in the margin): it isn't
    // body text and its box can't be drawn as a horizontal line.
    const rotated = Math.abs(tx[1]) > Math.abs(tx[0]) * 0.1 || Math.abs(tx[2]) > Math.abs(tx[3]) * 0.1;

    if (str.trim() && !rotated) {
      const fontH = Math.hypot(tx[2], tx[3]) || Math.abs(it.height) || 10;
      const x0 = tx[4];
      const baseline = tx[5];
      const x1 = x0 + (it.width || 0) * viewport.scale;
      const y0 = baseline - fontH;
      const y1 = baseline + fontH * 0.25;

      const sameLine =
        cur &&
        Math.abs(cur.baseline - baseline) < fontH * 0.6 &&
        x0 > cur.x0 - fontH && // not jumping back to the left
        x0 - cur.x1 < fontH * 3; // not a column gap

      if (!sameLine) {
        flush();
        cur = { text: "", x0, y0, x1, y1, baseline };
      } else {
        const gap = x0 - cur.x1;
        if (gap > fontH * 0.12 && !cur.text.endsWith(" ") && !str.startsWith(" ")) {
          cur.text += " ";
        }
      }
      cur.text += str;
      cur.x0 = Math.min(cur.x0, x0);
      cur.x1 = Math.max(cur.x1, x1);
      cur.y0 = Math.min(cur.y0, y0);
      cur.y1 = Math.max(cur.y1, y1);
    }

    if (it.hasEOL) flush();
  }
  flush();

  const W = viewport.width;
  const H = viewport.height;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  return lines.map((l) => ({
    t: l.text.replace(/\s+/g, " ").trim(),
    r: [
      r4(Math.max(0, l.x0 / W)),
      r4(Math.max(0, l.y0 / H)),
      r4(Math.min(1, (l.x1 - l.x0) / W)),
      r4(Math.min(1, (l.y1 - l.y0) / H)),
    ],
  }));
}

/** Join line texts, merging words hyphenated across line breaks. */
export function joinLines(lines) {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].t;
    if (i === lines.length - 1) out += t;
    else if (/[a-zA-Z]-$/.test(t)) out += t.slice(0, -1);
    else out += t + " ";
  }
  return out;
}

/**
 * Split pages into chunks of roughly CHUNK_TARGET_CHARS. Chunks never cross
 * pages, so each one maps to exactly one page for highlighting.
 */
export function chunkPages(pages) {
  const chunks = [];
  for (const { page, lines } of pages) {
    let buf = [];
    let len = 0;
    for (const line of lines) {
      buf.push(line);
      len += line.t.length + 1;
      if (len >= CHUNK_TARGET_CHARS) {
        chunks.push({ page, lines: buf, text: joinLines(buf) });
        buf = buf.slice(-CHUNK_OVERLAP_LINES);
        len = buf.reduce((n, l) => n + l.t.length + 1, 0);
      }
    }
    // Emit the remainder unless it is only the overlap we already emitted.
    const isOnlyOverlap = chunks.length > 0 && chunks.at(-1).page === page && buf.length <= CHUNK_OVERLAP_LINES;
    if (buf.length && !isOnlyOverlap) chunks.push({ page, lines: buf, text: joinLines(buf) });
  }
  return chunks.filter((c) => c.text.trim().length > 20);
}
