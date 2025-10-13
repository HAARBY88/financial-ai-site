// netlify/functions/generateStatements.js
// Accepts JSON:
// { framework, companyName, notes, files:[{kind,name,mimeType,base64}] }
//
// - PDF (application/pdf) -> sent as inlineData (base64)
// - Excel (.xls/.xlsx)    -> converted to CSV text and sent as a text part
// - Images (png/jpeg)     -> sent as inlineData (base64) so Gemini can READ them
//
// Env needed: GEMINI_API_KEY
// Optional:   GEMINI_MODEL (defaults to "gemini-2.5-flash")
// Optional:   DRY_RUN=1 (skips AI call, echoes what the function received)

import { GoogleGenAI } from "@google/genai";
import XLSX from "xlsx";

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/png", "image/jpeg"]); // image input for OCR/reading
const EXCEL_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function json(status, obj) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return PDF_MIME;
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "";
}

function buildPrompt({ framework, companyName, notes }) {
  return `
You are an expert ${framework} financial reporting assistant.
Using the uploaded materials (prior-year report as PDF or images, and current-year trial balance in CSV text),
produce a professional draft of the current-year financial statements for "${companyName || "the company"}".
Mirror the structure of the prior report when present. Map amounts from the trial balance. 
Flag missing disclosures required by ${framework}.

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

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const { framework = "IFRS", companyName = "", notes = "", files = [] } = body;

    if (!Array.isArray(files)) return json(400, { error: "`files` must be an array" });
    if (files.length === 0) return json(400, { error: "Please include at least one file in base64" });

    // Build Gemini parts: one user message with prompt, then attachments
    const parts = [{ text: buildPrompt({ framework, companyName, notes }) }];

    let totalApproxBytes = 0;
    const echo = [];

    for (const f of files) {
      if (!f) continue;
      const name = f.name || "unnamed";
      const mimeType = f.mimeType || guessMime(name);
      const base64 = typeof f.base64 === "string" ? f.base64.replace(/\s+/g, "") : "";

      if (!base64) return json(400, { error: `Missing base64 for file: ${name}` });

      const approxBytes = Math.round((base64.length * 3) / 4);
      totalApproxBytes += approxBytes;

      // Netlify function request body practical cap ~10MB
      if (totalApproxBytes > 10 * 1024 * 1024) {
        return json(400, {
          error: `Total upload too large (~${(totalApproxBytes / 1024 / 1024).toFixed(2)} MB).`,
          details: "Compress PDFs/images or split files. For big files, switch to object storage + server-side fetch.",
        });
      }

      if (mimeType === PDF_MIME || IMAGE_MIMES.has(mimeType)) {
        // ✅ PDFs & images: pass as inlineData (Gemini will read them)
        parts.push({ inlineData: { mimeType, data: base64 } });
        echo.push({ kind: f.kind, name, mimeType, approxKB: (approxBytes / 1024).toFixed(1) });
      } else if (EXCEL_MIMES.has(mimeType)) {
        // ✅ Excel: convert to CSV text so the model can read it
        let csvText = "";
        try {
          const buf = Buffer.from(base64, "base64");
          const wb = XLSX.read(buf, { type: "buffer" });
          const firstSheetName = wb.SheetNames[0];
          if (!firstSheetName) return json(400, { error: `No sheets found in workbook: ${name}` });
          const ws = wb.Sheets[firstSheetName];
          csvText = XLSX.utils.sheet_to_csv(ws);
          if (!csvText.trim()) {
            return json(400, { error: `Empty or unreadable sheet in workbook: ${name}` });
          }
        } catch (e) {
          return json(400, { error: `Failed to parse Excel: ${name}`, details: e?.message || String(e) });
        }

        parts.push({ text: `TRIAL BALANCE CSV (${name}):\n${csvText}` });
        echo.push({
          kind: f.kind, name, mimeType,
          approxKB: (approxBytes / 1024).toFixed(1),
          csvPreview: csvText.split("\n").slice(0, 5).join("\n")
        });
      } else {
        return json(400, {
          error: `Unsupported file type for ${name}: ${mimeType || "unknown"}. Upload PDF, PNG/JPEG, or Excel (.xls/.xlsx).`,
        });
      }
    }

    // Optional “no-AI” test path
    if (process.env.DRY_RUN === "1") {
      return json(200, {
        output: [
          "DRY_RUN active (no AI call).",
          `Framework: ${framework}`,
          `Company: ${companyName}`,
          `Notes length: ${notes.length}`,
          "Files received:",
          ...echo.map(e => `- ${e.name} (${e.mimeType}, ~${e.approxKB} KB)`)
        ].join("\n"),
        model: "DRY_RUN",
        debug: echo
      });
    }

    // Call Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json(500, { error: "Missing GEMINI_API_KEY" });

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash"; // multimodal text model (reads images/PDF)
    try {
      const genAI = new GoogleGenAI({ apiKey });
      const contents = [{ role: "user", parts }];
      const response = await genAI.models.generateContent({ model: modelName, contents });
      const text = response?.text?.();
      if (!text) return json(502, { error: "No text generated by Gemini", modelTried: modelName });
      return json(200, { output: text, model: modelName });
    } catch (e) {
      return json(500, { error: "Gemini request failed", details: e?.message || String(e) });
    }
  } catch (err) {
    return json(500, { error: "Unhandled server error", details: err?.message || String(err) });
  }
}











