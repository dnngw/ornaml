@AGENTS.md

# ornaml

Local-only "chat with your PDF" app (Next.js 16 App Router, JavaScript, Tailwind 4, SQLite). See README.md for the architecture and layout. Design decisions and limits (and why) are in docs/NOTES.md; keep it in sync when changing limits, modes or prompts. All project files (code, comments, docs, UI text) are written in English.

## Commands
- `npm run dev`: dev server (copies the pdf.js worker into `public/` first)
- `npm run build` / `npm run lint`
- `npm test`: unit tests with `node:test` for the pure modules in `src/lib` (a resolve hook in `test/support/` handles the extensionless and `@/` imports). Keep database/network code out of modules you want to unit-test (e.g. `answer.js` vs `rag.js`).
- `npm run format` / `npm run format:check`: Prettier, print width 120. Run before committing.

## Gotchas
- `cacheComponents` is on. GET route handlers must `await connection()` before reading SQLite, or they get prerendered at build time. Client hooks like `usePathname` on dynamic routes need a `<Suspense>` boundary.
- react-pdf 11 suspends by default. The viewer passes `suspense={false}` to `<Document>`. Otherwise the whole viewer is hidden while a page loads, which resets scroll and detaches refs.
- `pdfjs-dist` must stay pinned to the exact version react-pdf depends on (the worker is copied from it).
- Citations: the model cites `[S1]` (not `[1]`, which papers use for references) and appends a `<quotes>{json}</quotes>` block. The server strips it and stores `sources` (page + normalized rects) with the assistant message.
- Line rects are normalized `[x, y, w, h]` (0..1, top-left origin) relative to the page at scale 1.
- Background ingestion is fire-and-forget in the server process. A `processing` document whose `updated_at` is older than 3 min is marked interrupted (see `markStale` in lib/documents.js). Do not reset status at module init: in dev each route bundle re-inits `db.js`.
- `documents.progress` is machine-readable (`queued` | `extracting` | `embedding:<done>/<total>`); the UI maps it to words and a progress bar. Failures store a friendly `error`, an `error_code` and the raw `error_detail` — classify new failure kinds in `lib/errors.js`, not in the UI.
- Schema changes for existing databases go through `addColumn` in `lib/db.js` (idempotent: build workers init the DB concurrently).
- Answer modes (`lib/limits.js`): `full` (≤150 pages and ≤150k est. tokens; all chunks go in the system message, no embeddings, prefix-cache friendly) or `search` (embeddings + top-10). Documents from before modes existed have `mode = NULL`, which `documentMode()` in `lib/rag.js` derives from their size.
- The server logs one `[chat] … tokens in=… (cached …) out=…` line per answer, which is handy for checking cache hits and cost.
- Collections (`lib/collections.js`, `lib/multi.js`, `lib/prepare.js`): members reference library documents; chat history is in `collection_messages`. Strategy = `full` | `search` by total tokens of ready papers, plus user-chosen `deep`. Full-mode papers have no embeddings until a large collection needs them (`ensureEmbedded`, deduped per document). Both chat routes share `lib/chat-stream.js`.
