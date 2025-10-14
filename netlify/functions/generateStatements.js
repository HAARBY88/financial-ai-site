// netlify/functions/generateStatements.js
import { GoogleGenerativeAI } from "@google/genai";
import XLSX from "xlsx";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

const PDF = "application/pdf";
const IMG = new Set(["image/png", "image/jpeg"]);
const XLS = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const TXT = new Set(["text/plain", "text/csv", "application/csv"]);

function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return PDF;
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt")) return "text/plain";
  return "";
}

function buildPrompt(framework, companyName, notes) {
  return `
You are an expert ${framework} reporting assistant.
Use the uploaded prior-year report (PDF/images) and the current-year trial balance (CSV/text)
to draft current-year financial statements for "${companyName || "the company"}".

Deliver:
1) Income Statement (with prior-year comparative)
2) Balance Sheet (with prior-year comparative)
3) Draft accounting policies
4) Key notes (revenue, leases, instruments, PPE/intangibles)
5) List missing/uncertain disclosures to confirm with management

User notes:
${notes || "(none)"}  
`.trim();
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON", details: e.message });
  }

  const { framework = "IFRS", companyName = "", notes = "", files = [] } = body;
  if (!Array.isArray(files) || files.length === 0) {
    return json(400, { error: "Please include at least one file (PDF/image/TB)." });
  }

  const parts = [{ text: buildPrompt(framework, companyName, notes) }];
  const echo = [];
  let totalBytes = 0;

  try {
    for (const f of files) {
      if (!f) continue;
      const name = f.name || "unnamed";
      const mime = (f.mimeType || guessMime(name)) || "";
      let base64 = typeof f.base64 === "string" ? f.base64 : "";
      if (!base64) return json(400, { error: `Missing base64 for ${name}` });

      base64 = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
      const approx = Math.round((base64.length * 3) / 4);
      totalBytes += approx;
      if (totalBytes > 10 * 1024 * 1024) {
        return json(400, {
          error: `Payload too large (~${(totalBytes / 1024 / 1024).toFixed(2)} MB).`,
          details: "Compress files or send fewer pages.",
        });
      }

      if (mime === PDF || IMG.has(mime)) {
        parts.push({ inlineData: { mimeType: mime, data: base64 } });
        echo.push({ name, mime, approxKB: (approx / 1024).toFixed(1) });

      } else if (XLS.has(mime)) {
        const buf = Buffer.from(base64, "base64");
        const wb = XLSX.read(buf, { type: "buffer" });
        const first = wb.SheetNames[0];
        if (!first) return json(400, { error: `No sheets found in ${name}` });
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[first]) || "";
        if (!csv.trim()) return json(400, { error: `Empty sheet in ${name}` });
        parts.push({ text: `TRIAL BALANCE CSV (${name}):\n${csv}` });
        echo.push({ name, mime, approxKB: (approx / 1024).toFixed(1), preview: csv.split("\n").slice(0, 4).join("\n") });

      } else if (TXT.has(mime)) {
        const text = Buffer.from(base64, "base64").toString("utf8");
        if (!text.trim()) return json(400, { error: `Empty text in ${name}` });
        parts.push({ text: `TRIAL BALANCE TEXT (${name}):\n${text}` });
        echo.push({ name, mime, approxKB: (approx / 1024).toFixed(1), preview: text.split("\n").slice(0, 4).join("\n") });

      } else {
        return json(400, {
          error: `Unsupported type for ${name}: ${mime || "unknown"}`,
          details: "Use PDF/PNG/JPG for reports, XLS/XLSX/TXT/CSV for TB.",
        });
      }
    }
  } catch (e) {
    return json(400, { error: "File handling failed", details: e.message || String(e) });
  }

  // Optional: DRY_RUN to test the pipeline without calling Gemini
  if (process.env.DRY_RUN === "1") {
    return json(200, {
      output: [
        "DRY_RUN active (no AI call).",
        `Framework: ${framework}`,
        `Company: ${companyName}`,
        `Notes length: ${notes.length}`,
        "Files:",
        ...echo.map(e => `- ${e.name} (${e.mime}, ~${e.approxKB} KB)`),
      ].join("\n"),
      model: "DRY_RUN",
      debug: echo,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: "Missing GEMINI_API_KEY" });

  const modelName = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";

  // Add a 22s soft timeout (stay under Netlify’s hard limit)
  const abort = new AbortController();
  const t = setTimeout(() => abort.abort(), 22_000);

  try {
    const client = new GoogleGenerativeAI({ apiKey });
    const model = client.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(
      { contents: [{ role: "user", parts }] },
      { signal: abort.signal }
    );
    clearTimeout(t);

    // ✔ Correct extraction for @google/genai
    const text =
      result.output_text ??
      result.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") ??
      "";

    if (!text) {
      // Handle safety blocks or empty output explicitly
      return json(502, {
        error: "No text generated by Gemini",
        model: modelName,
        finishReason: result.candidates?.[0]?.finish_reason,
        safetyRatings: result.candidates?.[0]?.safety_ratings,
        raw: result, // keep for debugging (can remove later)
      });
    }

    // success
    return json(200, { output: text, model: modelName });

  } catch (e) {
    clearTimeout(t);
    // If aborted, make that obvious
    if (e.name === "AbortError") {
      return json(504, { error: "Timeout: Gemini did not respond in time" });
    }
    return json(500, { error: "Gemini request failed", details: e.message || String(e) });
  }
}













