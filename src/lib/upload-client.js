// Browser-side PDF upload, shared by the Documents page and the collection dialog.
import { MAX_PAGES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./limits";

const isPdf = (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

/** Check size and page count in the browser, before uploading. Returns a problem or null. */
async function checkPdf(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `the file is ${(file.size / 1024 / 1024).toFixed(1)} MB, and the limit is ${MAX_UPLOAD_MB} MB.`;
  }
  try {
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const pages = pdf.numPages;
    await task.destroy();
    if (pages > MAX_PAGES) {
      return `it has ${pages} pages, and the limit is ${MAX_PAGES}. ornaml is built for papers.`;
    }
  } catch {
    // Unreadable or password-protected: let the server report it clearly.
  }
  return null;
}

/**
 * Check and upload files. onFileDone(name) fires as each file finishes.
 * @returns {Promise<{ ids: string[], problems: string[] }>} new document ids and plain-language problems
 */
export async function uploadPdfs(fileList, { onFileDone } = {}) {
  const chosen = [...fileList];
  const pdfs = chosen.filter(isPdf);
  const problems = [];
  const ids = [];
  if (pdfs.length < chosen.length) {
    problems.push(`${chosen.length - pdfs.length} file(s) skipped: only PDF files can be uploaded.`);
  }
  await Promise.all(
    pdfs.map(async (file) => {
      try {
        const problem = await checkPdf(file);
        if (problem) return problems.push(`"${file.name}" wasn't uploaded: ${problem}`);
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const j = await res.json().catch(() => ({}));
        if (res.ok) ids.push(j.id);
        else problems.push(`"${file.name}" wasn't uploaded: ${j.error || res.statusText}`);
      } catch {
        problems.push(`"${file.name}" wasn't uploaded: the app couldn't be reached. Is it still running?`);
      } finally {
        onFileDone?.(file.name);
      }
    }),
  );
  return { ids, problems, names: pdfs.map((f) => f.name) };
}
