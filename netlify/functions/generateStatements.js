// netlify/functions/generateStatements.js
// Accepts JSON { framework, companyName, notes, files:[{kind,name,mimeType,base64}] }
// Improved: clearer errors for invalid base64 and oversize uploads.

import { GoogleGenAI, createUserContent, createPartFromBuffer } from "@google/genai";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function buildPrompt({ framework, companyName, notes }) {
  return `
You are an expert ${framework} financial reporting assistant.
Using the uploaded documents (prior-year PDF and/or current-year trial balance in Excel),
generate a professional draft of the current-year financial statements for "${companyName || "the company"}".
Reflect the structure and tone of the prior report when present. Map amounts from the trial balance where possible.
Clearly flag any missing disclosures required by ${framework}.

User notes:
${notes || "(none)"}

Output sections:
1) Statement of Profit or Loss (with comparatives)
2) Statement of Financial Position (with comparatives)
3) Key accounting policies (brief)
4) Key notes (revenue, leases, instruments, PPE/intangibles)
5) Missing disclosures list
`.trim();
}

const ALLOWED = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Helper: infer mime from filename if browser didn’t set one
function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "";
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json(500, { error: "Missing GEMINI_API_KEY" });

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const { framework = "IFRS", companyName = "", notes = "", files = [] } = body;
    if (!Array.isArray(files)) return json(400, { error: "`files` must be an array" });
    if (files.length === 0) return json(400, { error: "Please include at least one file in base64" });

    // Netlify request size guard: if event.body is very large, it may be truncated silently.
    // We can sanity-check base64 segments and sizes below.
    const parts = [];
    let totalBytes = 0;

    for (const f of files) {
      if (!f) continue;
      const name = f.name || "unnamed";
      const mimeType = f.mimeType || guessMime(name);

      if (!f.base64 || typeof f.base64 !== "string") {
        return json(400, { error: `Missing base64 for file: ${name}` });
      }

      if (!mimeType || !ALLOWED.has(mimeType)) {
        return json(400, { error: `Unsupported file type for ${name}: ${mimeType || "unknown"}. Upload PDF or Excel.` });
      }

      // Base64 sanitation (remove whitespace)
      const b64 = f.base64.replace(/\s+/g, "");

      // Quick integrity check: base64 length should be divisible by 4 (commonly true)
      if (b64.length % 4 !== 0) {
        return json(400, {
          error: `The uploaded base64 for ${name} looks incomplete (length not multiple of 4).`,
          details: "This often happens when the file is too large for a single request and got truncated by the server. Try a smaller file (≤ 8–9 MB) or split the PDF.",
        });
      }

      let buf;
      try {
        buf = Buffer.from(b64, "base64");
      } catch {
        return json(400, {
          error: `Failed to decode file: ${name}`,
          details: "The base64 payload appears invalid or truncated. Try reselecting the file or using a smaller file.",
        });
      }

      // Another sanity check: decoded buffer should be non-empty
      if (!buf || !buf.length) {
        return json(400, { error: `Decoded file is empty: ${name}` });
      }

      totalBytes += buf.length;

      // Soft limit (Netlify request size ~10 MB). If we reached here, base64 passed integrity check,
      // but still warn if total payload likely exceeds typical limits.
      if (totalBytes > 10 * 1024 * 1024) {
        return json(400, {
          error: `Total upload too large (~${Math.round(totalBytes / 1024 / 1024)} MB).`,
          details: "Netlify Functions requests are limited (≈10 MB). Please compress your PDF, upload only key pages, or reduce file size.",
        });
      }

      parts.push(createPartFromBuffer(buf, mimeType));
    }

    if (parts.length === 0) {
      return json(400, { error: "No valid files after decoding (PDF/Excel only)." });
    }

    const prompt = buildPrompt({ framework, companyName, notes });

    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: modelName,
      contents: [createUserContent([prompt, ...parts])],
    });

    const text = response?.text?.();
    if (!text) return json(502, { error: "No text generated by Gemini", modelTried: modelName });

    return json(200, { output: text, model: modelName });
  } catch (err) {
    console.error("generateStatements error:", err);
    return json(500, { error: "Gemini request failed", details: err?.message || String(err) });
  }
}







