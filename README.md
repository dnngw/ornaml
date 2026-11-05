# ornaml

Chat with your PDFs locally. Upload a PDF, ask questions in any language, and get answers with citations. Click a citation to jump to the exact lines highlighted in the PDF.

Runs on `localhost` only. There are no accounts, and you bring your own API keys.

## Requirements

- Node.js 20.9+
- An API key for a **chat model** (any OpenAI-compatible API)
- An API key for an **embedding model** (any OpenAI-compatible `/embeddings` API). Only needed for PDFs over 150 pages and large collections.

## Collections

Group papers into a **collection** to ask questions across all of them (compare methods, datasets, results). Small collections are read whole; large ones use a summary of every paper plus the most relevant parts of each; **Deep compare** reads every paper in full before answering.

## Getting started

```bash
git clone https://github.com/dnngw/ornaml.git && cd ornaml
npm install
npm run dev
```

Open http://localhost:3000/settings, paste both API keys, click **Save & test**, then upload a PDF on the home page.

Instead of the Settings page, you can copy `.env.example` to `.env.local` and fill in the keys there. Values saved in the UI take precedence.

## How it works

1. **Upload.** The browser checks the limits first (30 MB, 300 pages). The PDF is saved to `data/uploads/`, and the server extracts text line by line with pdf.js, keeping each line's position on the page. The text is split into ~1000-character chunks, each within a single page.
2. **Choose a mode.**
   - **Full document** (up to 150 pages and ~150k tokens, which covers almost every paper): the chat model reads every chunk for every question. No embeddings are needed.
   - **Search** (longer documents): chunks are embedded, and each question gets the 10 most similar chunks. The UI tells the user that answers come from the most relevant sections.
3. **Ask.** Chunks are sent as numbered sources `[S1]…`, and the answer streams back. In full-document mode the document sits at the start of the prompt, so DeepSeek's prefix cache bills follow-up questions about the same document at the cache-hit rate.
4. **Cite & highlight.** The model cites sources inline and returns short verbatim quotes plus a `found` flag. Each quote is matched back to its PDF lines and highlighted. Citations whose quote can't be matched are marked "approximate" and highlight the whole chunk. Answers the document doesn't cover get a "Not found in this document" note.

Everything (documents, chunks, embeddings, chat history, saved keys) lives in `data/app.db` (SQLite). Delete the `data/` folder to start fresh.


## Limitations

- Only text-based PDFs. Scanned PDFs (images only) need OCR, which isn't supported. Text inside images and charts isn't read.
- Up to 30 MB and 300 pages per PDF.
- If you change the embedding model, prepare long documents (search mode) again. Old and new vectors aren't comparable, and the app will tell you.
- Saved API keys are stored unencrypted in the local database. Don't expose the server beyond localhost.

## Project layout

```
src/
  app/
    layout.js                     root layout and header
    page.js                       documents: upload, collections, library
    documents/[id]/page.js        one paper: PDF viewer + chat
    collections/[id]/page.js      a collection: PDF tabs + chat across papers
    settings/page.js              API keys & models
    globals.css                   design tokens and shared styles (neo-brutalism)
    api/
      documents/                  upload, list, delete, file, reprocess, messages, chat stream
      collections/                create, list, update, delete, messages, chat stream
      settings/                   read/save settings, test the connection
  components/
    DocumentsPage.js              upload area, collections list, library list
    DocumentCard.js               one paper in the library (status, errors, actions)
    CollectionCard.js             one collection on the documents page
    CollectionDialog.js           create / manage a collection (papers, upload, rename)
    Pager.js                      "Showing 1–10 of 77 · ‹ Prev 1 2 … Next ›"
    ChatView.js                   one-paper chat page (PDF + chat)
    CollectionView.js             collection chat page (paper tabs + chat)
    ChatPanel.js                  chat input, streaming, answer mode, errors
    ChatMessages.js               message bubbles, citation chips, sources list
    PdfViewer.js                  PDF pages, highlights, zoom, reading position
    SplitView.js                  side-by-side panes; PDF / Chat switch on phones
    useMobileView.js              which pane small screens show
    SettingsForm.js               API keys & models form
    ConfirmDialog.js, InfoTip.js, Header.js, NavLinks.js
  lib/
    pdf.js            text + line-position extraction, chunking
    ingest.js         background processing: extract → chunk → (embed long documents) → store
    rag.js            one paper: full-document / search retrieval and prompts
    multi.js          collections: full / search strategies, deep compare, prompts
    answer.js         parse the model output, build citations with highlight boxes
    match.js          map a quoted sentence back to PDF lines
    cite.js           citation markers and per-answer numbering (shared with the browser)
    collections.js    collection membership and strategy choice
    prepare.js        on-demand embeddings and paper summaries for large collections
    documents.js      document queries shared by the API routes
    ai.js             OpenAI-compatible chat (streaming) and embedding clients
    chat-stream.js    NDJSON streaming shared by both chat routes
    errors.js         technical errors → plain-language messages
    limits.js         upload, page, mode and collection limits (shared with the browser)
    settings.js       settings resolution: UI → .env → defaults
    db.js             SQLite schema and migrations
    upload-client.js  browser-side checks and upload
    vectors.js        cosine similarity, embedding (de)serialization
    async.js          limited-concurrency helper
    format.js         sizes, dates, short file names
test/                             unit tests (node:test), run with `npm test`
scripts/copy-pdf-worker.mjs       copies the pdf.js worker into /public (runs before dev/build)
```

## Development

```bash
npm test             # unit tests (no API keys or database needed)
npm run lint         # ESLint (Next.js rules + no-undef / no-unused-vars)
npm run format       # Prettier (format:check to verify)
```

## License

[MIT](LICENSE)
