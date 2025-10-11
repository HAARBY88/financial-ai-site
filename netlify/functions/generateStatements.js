// netlify/functions/generateStatements.js
// Accepts JSON { framework, companyName, notes, files:[{kind,name,mimeType,base64}] }.
// - PDF: passed as inlineData (base64) to Gemini
// - Excel (.xls/.xlsx): converted to CSV text and sent as a text part
// Requires env: GEMINI_API_KEY, optional: GEMINI_MODEL (default gemini-2.5-flash)

import { GoogleGenAI } from "@google/genai";
import XLSX from "xlsx";

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
Using the uploaded materials (prior-year PDF and/or current-year trial balance in CSV text),
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

// Supported direct uploads (PDF only). Excel is handled via CSV conversion.
const PDF_MIME = "application/pdf";
const EXCEL_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return PDF_MIME;
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

    // Build Gemini "contents": one user message with a prompt + parts for PDF inlineData and TB CSV text
    const parts = [{ text: buildPrompt({ framework, companyName, notes }) }];

    let totalApproxBytes = 0;

    for (const f of files) {
      if (!f) continue;
      const name = f.name || "unnamed";
      const mimeType = f.mimeType || guessMime(name);
      const base64 = typeof f.base64 === "string" ? f.base64.replace(/\s+/g, "") : "";

      if (!base64) return json(400, { error: `Missing base64 for file: ${name}` });
      // Approx decoded size (avoid oversized requests)
      const approxBytes = Math.round((base64.length * 3) / 4);
      totalApproxBytes += approxBytes;
      if (totalApproxBytes > 10 * 1024 * 1024) {
        return json(400, {
          error: `Total upload too large (~${(totalApproxBytes/1024/1024).toFixed(2)} MB).`,
          details: "Netlify Functions requests are limited (≈10 MB). Please compress your PDF or reduce file size.",
        });
      }

      if (mimeType === PDF_MIME) {
        // ✅ Pass PDF as inlineData
        parts.push({
          inlineData: { mimeType, data: base64 }
        });
      } else if (EXCEL_MIMES.has(mimeType)) {
        // ✅ Convert Excel → CSV text and attach as a text part
        // Decode base64 into a Buffer so XLSX can parse it
        let buf;
        try {
          buf = Buffer.from(base64, "base64");
        } catch {
          return json(400, { error: `Failed to decode Excel file: ${name}` });
        }

        // Read workbook and convert the first sheet to CSV
        let csvText = "";
        try {
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

        // Add as a text part (Gemini-friendly)
        parts.push({
          text:
`TRIAL BALANCE CSV (${name}):
${csvText}`
        });
      } else {
        // Unsupported file types are ignored with a gentle message
        return json(400, {
          error: `Unsupported file type for ${name}: ${mimeType || "unknown"}. Upload PDF or Excel (.xls/.xlsx).`
        });
      }
    }

    const genAI = new GoogleGenAI({ apiKey });
    const contents = [{ role: "user", parts }];

    const response = await genAI.models.generateContent({ model: modelName, contents });
    const text = response?.text?.();
    if (!text) return json(502, { error: "No text generated by Gemini", modelTried: modelName });

    return json(200, { output: text, model: modelName });
  } catch (err) {
    console.error("generateStatements error:", err);
    return json(500, { error: "Gemini request failed", details: err?.message || String(err) });
  }
}








