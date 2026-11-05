import { db } from "./db";

// Each value resolves in order: saved in the UI (SQLite) -> environment variable -> default.
// Both providers just need an OpenAI-compatible API, so any vendor works.
export const SETTING_DEFS = {
  chat_base_url: { env: "CHAT_BASE_URL", default: "https://api.deepseek.com" },
  chat_model: { env: "CHAT_MODEL", default: "deepseek-flash" },
  chat_api_key: { env: "CHAT_API_KEY", secret: true },
  embed_base_url: { env: "EMBED_BASE_URL", default: "https://openrouter.ai/api/v1" },
  embed_model: { env: "EMBED_MODEL", default: "nvidia/nemotron-3-embed-1b:free" },
  embed_api_key: { env: "EMBED_API_KEY", secret: true },
};

function savedValues() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Full resolved settings, including secrets. Server-side only. */
export function getSettings() {
  const saved = savedValues();
  const out = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    out[key] = saved[key] || process.env[def.env] || def.default || "";
  }
  return out;
}

/** Safe for the browser: secrets are replaced by a hint. */
export function getPublicSettings() {
  const saved = savedValues();
  const out = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const source = saved[key] ? "ui" : process.env[def.env] ? "env" : def.default ? "default" : null;
    const value = saved[key] || process.env[def.env] || def.default || "";
    if (def.secret) {
      out[key] = { set: Boolean(value), hint: value ? `••••${value.slice(-4)}` : "", source };
    } else {
      out[key] = { value, source };
    }
  }
  return out;
}

/**
 * Save values from the UI. For secrets, `undefined` keeps the current value
 * and an empty string removes the saved one.
 */
export function saveSettings(input) {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const remove = db.prepare("DELETE FROM settings WHERE key = ?");
  db.transaction(() => {
    for (const key of Object.keys(SETTING_DEFS)) {
      if (!(key in input) || input[key] === undefined || input[key] === null) continue;
      const value = String(input[key]).trim();
      if (value) upsert.run(key, value);
      else remove.run(key);
    }
  })();
}

export function chatConfig() {
  const s = getSettings();
  return { baseUrl: s.chat_base_url, model: s.chat_model, apiKey: s.chat_api_key };
}

export function embedConfig() {
  const s = getSettings();
  return { baseUrl: s.embed_base_url, model: s.embed_model, apiKey: s.embed_api_key };
}
