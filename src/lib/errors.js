// Turn technical failures into short messages a non-technical user can act on.
// The raw error is kept separately (documents.error_detail) for "Show details".
//
// Codes:
//   missing_key, auth, model, connection -> fix in Settings (FIX_IN_SETTINGS)
//   quota, busy, service, unknown -> try again later
//   no_text, bad_pdf, too_many_pages -> needs a different file
//
// Errors from lib/ai.js carry `err.service` ("chat" | "embedding"), which wins
// over the caller's guess, so a message always names the right Settings section.

/** Error codes the user fixes on the Settings page (the UI shows an "Open Settings" button). */
export const FIX_IN_SETTINGS = new Set(["missing_key", "auth", "model", "connection"]);

// Names match the section titles on the Settings page.
const SERVICE_NAMES = { chat: "chat model", embedding: "embedding model" };

export function describeError(err, service = "embedding") {
  const msg = String(err?.message || err || "");
  const status = err?.status;
  const name = SERVICE_NAMES[err?.service ?? service] ?? SERVICE_NAMES.embedding;

  if (err?.code === "missing_key") {
    return { code: "missing_key", message: `The API key for the ${name} isn't set yet. Add it in Settings.` };
  }
  if (err?.code === "too_many_pages") {
    return {
      code: "too_many_pages",
      message:
        "This PDF is too long (more than 300 pages). ornaml is built for papers; please upload a shorter document.",
    };
  }
  if (err?.code === "no_text") {
    return {
      code: "no_text",
      message: "This PDF has no selectable text. It's probably a scanned document, which isn't supported yet.",
    };
  }
  if (err?.name === "PasswordException" || /password/i.test(msg)) {
    return { code: "bad_pdf", message: "This PDF is password-protected. Remove the password and upload it again." };
  }
  if (err?.name === "InvalidPDFException" || /invalid pdf|corrupt/i.test(msg)) {
    return { code: "bad_pdf", message: "This file couldn't be read as a PDF. It may be damaged." };
  }
  if (err?.code === "quota" || status === 402 || /quota|credit|insufficient|balance|per-day|daily/i.test(msg)) {
    return {
      code: "quota",
      message: `The usage limit of the ${name} has been reached. Try again later, or check your plan or credits with the provider.`,
    };
  }
  if (status === 401 || status === 403) {
    return { code: "auth", message: `The ${name} rejected the API key. Check the key in Settings.` };
  }
  if (status === 404 || /model.*(not found|does not exist|invalid)|no such model|unknown model/i.test(msg)) {
    return { code: "model", message: `The ${name} doesn't recognize the model name. Check the model in Settings.` };
  }
  if (status === 429) {
    return { code: "busy", message: `The ${name} is busy right now (too many requests). Try again in a minute.` };
  }
  if (status >= 500) {
    return { code: "service", message: `The ${name} is having problems on its side. Try again in a few minutes.` };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|timed? ?out|network|aborted/i.test(msg)) {
    return {
      code: "connection",
      message: `Couldn't reach the ${name}. Check your internet connection and the Base URL in Settings.`,
    };
  }
  return {
    code: "unknown",
    message:
      (err?.service ?? service) === "chat"
        ? "Something went wrong while answering. Try again."
        : "Something went wrong while preparing this document. Try again.",
  };
}
