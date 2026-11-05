import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR)
  : path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
export const UPLOAD_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "uploads");

function init() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new Database(path.join(/*turbopackIgnore: true*/ DATA_DIR, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      size        INTEGER NOT NULL,
      num_pages   INTEGER,
      status      TEXT NOT NULL DEFAULT 'processing', -- processing | ready | error
      progress    TEXT,
      error       TEXT,           -- friendly message shown to the user
      error_code  TEXT,           -- see lib/errors.js
      error_detail TEXT,          -- raw technical message ("Show details")
      embed_model TEXT,
      mode        TEXT,           -- full | search (see lib/limits.js)
      est_tokens  INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      idx         INTEGER NOT NULL,
      page        INTEGER NOT NULL,
      text        TEXT NOT NULL,
      lines       TEXT NOT NULL,  -- JSON: [{ t, r: [x, y, w, h] }]
      embedding   BLOB            -- Float32Array bytes
    );
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id, idx);

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,  -- user | assistant
      content     TEXT NOT NULL,
      sources     TEXT,           -- JSON (assistant only)
      found       INTEGER,        -- 1/0: did the sources answer it? NULL: small talk / unknown
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_document ON messages(document_id, id);

    -- Collections: folders that reference papers in the library (no copies)
    -- and have their own chat history.
    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_documents (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      added_at      INTEGER NOT NULL,
      PRIMARY KEY (collection_id, document_id)
    );
    CREATE TABLE IF NOT EXISTS collection_messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,  -- user | assistant
      content       TEXT NOT NULL,
      sources       TEXT,           -- JSON; each source also carries docId/docName
      found         INTEGER,
      strategy      TEXT,           -- full | search | deep (assistant only)
      papers_read   INTEGER,        -- deep compare: how many papers were read in full
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collection_messages_collection ON collection_messages(collection_id, id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migrations for databases created by earlier versions.
  // Several processes (e.g. build workers) may race here, so tolerate a column
  // that another process added a moment ago.
  const addColumn = (table, column, type) => {
    const cols = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
    if (cols.includes(column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  };
  addColumn("documents", "error_code", "TEXT");
  addColumn("documents", "error_detail", "TEXT");
  addColumn("messages", "found", "INTEGER");
  addColumn("documents", "mode", "TEXT");
  addColumn("documents", "est_tokens", "INTEGER");
  addColumn("documents", "card", "TEXT"); // JSON paper summary, made when a large collection needs it

  return db;
}

// Reuse one connection across hot reloads in dev.
export const db = globalThis.__ornamlDb ?? (globalThis.__ornamlDb = init());

export function documentPath(id) {
  return path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, `${id}.pdf`);
}
