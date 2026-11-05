"use client";

import { useEffect, useState } from "react";

const SECTIONS = [
  {
    kind: "chat",
    title: "Chat model",
    desc: "Required. Reads your papers and writes the answers. Any OpenAI-compatible API works. Default: DeepSeek.",
    fields: { base: "chat_base_url", model: "chat_model", key: "chat_api_key" },
    keyHelp: "platform.deepseek.com → API keys",
  },
  {
    kind: "embed",
    title: "Embedding model",
    desc: "Optional, but needed when there's too much text to read in one go. It finds the most relevant parts for each question.",
    // Shown under the description: when it is (and isn't) used, in plain words.
    details: [
      "Needed for: PDFs over 150 pages, and collections whose papers are too much to read together (often around 10 or more papers).",
      "Not needed for: regular papers and small collections. They are read in full.",
      "Changed the model? Long documents show “Try again” on the Documents page; collections update on their own.",
    ],
    missingKeyNote:
      "No key yet: regular papers and small collections work, but long PDFs and large collections will ask for this key.",
    fields: { base: "embed_base_url", model: "embed_model", key: "embed_api_key" },
    keyHelp: "openrouter.ai → Keys",
  },
];

const SOURCE_LABEL = { ui: "saved here", env: "from .env", default: "default" };

export default function SettingsForm() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [status, setStatus] = useState({}); // kind -> { state, message }

  function reset(s) {
    setSettings(s);
    setForm({
      chat_base_url: s.chat_base_url.value,
      chat_model: s.chat_model.value,
      embed_base_url: s.embed_base_url.value,
      embed_model: s.embed_model.value,
      chat_api_key: "",
      embed_api_key: "",
    });
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => reset(j.settings));
  }, []);

  async function save(section, extra = {}) {
    const f = section.fields;
    const body = { [f.base]: form[f.base], [f.model]: form[f.model], ...extra };
    if (form[f.key]) body[f.key] = form[f.key]; // empty input = keep current key
    setStatus((s) => ({ ...s, [section.kind]: { state: "saving", message: "Saving…" } }));
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    const j = await res.json();
    reset(j.settings);
    setStatus((s) => ({ ...s, [section.kind]: { state: "ok", message: "Saved." } }));
    return j.settings;
  }

  async function test(section) {
    await save(section);
    setStatus((s) => ({ ...s, [section.kind]: { state: "saving", message: "Testing…" } }));
    const res = await fetch("/api/settings/test", { method: "POST", body: JSON.stringify({ kind: section.kind }) });
    const j = await res.json();
    setStatus((s) => ({ ...s, [section.kind]: { state: j.ok ? "ok" : "error", message: j.message } }));
  }

  async function clearKey(section) {
    await save(section, { [section.fields.key]: "" });
    setStatus((s) => ({ ...s, [section.kind]: { state: "ok", message: "Saved key removed." } }));
  }

  if (!settings) return <p className="p-10 text-sm text-stone-500">Loading…</p>;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-12">
      <span className="nb-tag">Bring your own keys</span>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-stone-600">
        Keys are stored only in your local database (<code className="font-mono text-xs">data/app.db</code>) and never
        sent to the browser. Values saved here override <code className="font-mono text-xs">.env</code>.
      </p>

      {SECTIONS.map((sec) => {
        const f = sec.fields;
        const key = settings[f.key];
        const st = status[sec.kind];
        return (
          <section key={sec.kind} className="nb-card mt-8 p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink bg-accent font-display text-sm font-bold text-white">
                {sec.kind === "chat" ? "AI" : "≋"}
              </span>
              <div>
                <h2 className="font-display text-lg font-bold">{sec.title}</h2>
                <p className="text-sm text-stone-600">{sec.desc}</p>
              </div>
            </div>
            {sec.details && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
                {sec.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            {sec.missingKeyNote && !key.set && !/localhost|127\.0\.0\.1/.test(form[f.base] || "") && (
              <p className="mt-3 rounded-md border-2 border-ink bg-cite px-3 py-2 text-sm font-medium">
                {sec.missingKeyNote}
              </p>
            )}

            <div className="mt-4 grid gap-4">
              <Field label="Base URL" hint={SOURCE_LABEL[settings[f.base].source]}>
                <input
                  value={form[f.base]}
                  onChange={(e) => setForm({ ...form, [f.base]: e.target.value })}
                  className="nb-input"
                  spellCheck={false}
                />
              </Field>
              <Field label="Model" hint={SOURCE_LABEL[settings[f.model].source]}>
                <input
                  value={form[f.model]}
                  onChange={(e) => setForm({ ...form, [f.model]: e.target.value })}
                  className="nb-input"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="API key"
                hint={key.set ? `${key.hint} · ${SOURCE_LABEL[key.source]}` : "not set"}
                help={`Get one at ${sec.keyHelp}`}
              >
                <input
                  type="password"
                  value={form[f.key]}
                  placeholder={key.set ? "Leave empty to keep the current key" : "Paste your API key"}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="nb-input"
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={() => save(sec)} className="nb-btn nb-btn-primary">
                Save
              </button>
              <button onClick={() => test(sec)} className="nb-btn">
                Save &amp; test
              </button>
              {key.source === "ui" && (
                <button onClick={() => clearKey(sec)} className="nb-btn nb-btn-sm nb-btn-danger">
                  Remove saved key
                </button>
              )}
              {st && (
                <span
                  className={`rounded border-[1.5px] border-ink px-2 py-0.5 text-sm font-medium ${
                    st.state === "error"
                      ? "bg-red-100 text-red-800"
                      : st.state === "ok"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-white"
                  }`}
                >
                  {st.message}
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Field({ label, hint, help, children }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between font-display text-sm font-bold">
        {label}
        {hint && <span className="font-sans text-xs font-normal text-stone-500">{hint}</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {help && <span className="mt-1 block text-xs text-stone-500">{help}</span>}
    </label>
  );
}
