// netlify/functions/generateStatements.js
import { GoogleGenAI } from "@google/genai";
import XLSX from "xlsx";

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);
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
Using the uploaded prior-year financial statements (PDF or images) and the current-year trial balance (CSV text),
reconstruct a professional draft of the current-year financial statements for "${companyName || "the company"}".
Mirror the structure of the prior year where appropriate and map amounts from the trial balance.
Flag any missing disclosures required by ${framework}.

User notes:
${notes || "(none)"}

Deliver:
1) Statement of Profit or Loss and Other Comprehensive Income (with comparatives)
2) Statement of Financial Position (with comparatives)
3) Key accounting policies (brief)
4) Key notes (revenue, leases, instruments, PPE/intangibles)
5) List of missing or uncertain disclosures to confirm
`.trim();
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "Invalid JSON body", details: e?.message });
    }

    const { framework = "IFRS", companyName = "", notes = "", files = [] } = body;
    if (!Array.isArray(files) || files.length === 0) {
      return json(400, { error: "Please include at least one file as base64." });
    }

    // Build Gemini parts: prompt + attachments
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

      // Netlify request body practical cap ~10 MB
      if (totalApproxBytes > 10 * 1024 * 1024) {
        return json(400, {
          error: `Total upload too large (~${(totalApproxBytes / 1024 / 1024).toFixed(2)} MB).`,
          details: "Compress PDFs/images or split files. For large files, switch to object storage + server-side fetch.",
        });
      }

      if (mimeType === PDF_MIME || IMAGE_MIMES.has(mimeType)) {
        parts.push({ inlineData: { mimeType, data: base64 } });
        echo.push({ name, mimeType, approxKB: (approxBytes / 1024).toFixed(1) });
      } else if (EXCEL_MIMES.has(mimeType)) {
        try {
          const buf = Buffer.from(base64, "base64");
          const wb = XLSX.read(buf, { type: "buffer" });
          const firstSheet = wb.SheetNames[0];
          if (!firstSheet) return json(400, { error: `No sheets found in workbook: ${name}` });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet]);
          if (!csv.trim()) return json(400, { error: `Empty or unreadable sheet in workbook: ${name}` });
          parts.push({ text: `TRIAL BALANCE CSV (${name}):\n${csv}` });
          echo.push({ name, mimeType, approxKB: (approxBytes / 1024).toFixed(1), csvPreview: csv.split("\n").slice(0, 5).join("\n") });
        } catch (e) {
          return json(400, { error: `Failed to parse Excel: ${name}`, details: e?.message || String(e) });
        }
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

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    try {
      const genAI = new GoogleGenAI({ apiKey });
      const contents = [{ role: "user", parts }];
      const response = await genAI.models.generateContent({ model: modelName, contents });
      const text = response?.text?.();
      if (!text) {
        // Return entire response for visibility
        return json(502, { error: "No text generated by Gemini", modelTried: modelName, raw: response });
      }
      return json(200, { output: text, model: modelName });
    } catch (e) {
      // Bubble up Gemini HTTP details if available
      return json(500, {
        error: "Gemini request failed",
        details: e?.message || String(e),
      });
    }
  } catch (err) {
    return json(500, { error: "Unhandled server error", details: err?.message || String(err) });
  }
}












