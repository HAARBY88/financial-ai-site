// netlify/functions/readTrialBalances.js
// POST multipart/form-data with fields: tbPrior (file), tbCurrent (file)
// Supports .xlsx, .xls, .csv
// -> { tbParsed: { prior: {Name: amount}, current: {...} }, totals: {...} }

const multiparty = require("multiparty");
const fs = require("fs");
const XLSX = require("xlsx");

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    const bodyBuffer = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    form.parse(
      {
        headers: event.headers || {},
        on: (name, cb) => {
          if (name === "data") cb(bodyBuffer);
          if (name === "end") cb();
          return this;
        }
      },
      (err, fields, files) => (err ? reject(err) : resolve({ fields, files }))
    );
  });
}

function parseCSV(buffer) {
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return {};
  // naive CSV split; good enough for simple TBs
  const rows = lines.map(l => l.split(",").map(s => s.replace(/^"|"$/g, "").trim()));
  // Try to find name + amount columns:
  // Heuristic: first non-empty header is name, the next numeric-ish column is amount
  const header = rows[0].map(h => h.toLowerCase());
  let nameIdx = 0;
  let amtIdx = 1;
  // If there's an obvious "amount" column
  const amtCand = header.findIndex(h => /amount|debit|credit|balance/.test(h));
  if (amtCand > -1) amtIdx = amtCand;

  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] || "").trim();
    const amtRaw = (r[amtIdx] || "").replace(/[, ]/g, "");
    if (!name) continue;
    const num = Number(amtRaw);
    if (isNaN(num)) continue;
    out[name] = (out[name] || 0) + num;
  }
  return out;
}

function parseXLSX(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!rows || !rows.length) return {};
  // Heuristic: first column = name, the most numeric column = amount
  // Find the column with the most numeric values among first 5 columns
  let amtIdx = 1;
  let bestScore = -1;
  const maxCols = Math.min(5, rows[0].length);
  for (let c = 1; c < maxCols; c++) {
    let score = 0;
    for (let r = 1; r < rows.length; r++) {
      const v = rows[r][c];
      if (typeof v === "number") score++;
      else if (typeof v === "string" && v.trim() && !isNaN(Number(v.replace(/[, ]/g, "")))) score++;
    }
    if (score > bestScore) { bestScore = score; amtIdx = c; }
  }
  const out = {};
  for (let r = 1; r < rows.length; r++) {
    const name = (rows[r][0] ?? "").toString().trim();
    if (!name) continue;
    let val = rows[r][amtIdx];
    if (typeof val === "string") val = Number(val.replace(/[, ]/g, ""));
    if (typeof val !== "number" || isNaN(val)) continue;
    out[name] = (out[name] || 0) + val;
  }
  return out;
}

function parseTBFile(buffer, filename = "") {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return parseCSV(buffer);
  // default: try xlsx/xls
  return parseXLSX(buffer);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { files } = await parseMultipart(event);
    const fPrior = files?.tbPrior?.[0];
    const fCurrent = files?.tbCurrent?.[0];
    if (!fPrior || !fCurrent) {
      return { statusCode: 400, body: JSON.stringify({ error: "Both tbPrior and tbCurrent are required" }) };
    }

    const bufPrior = fs.readFileSync(fPrior.path);
    const bufCurrent = fs.readFileSync(fCurrent.path);

    const prior = parseTBFile(bufPrior, fPrior.originalFilename || fPrior.path);
    const current = parseTBFile(bufCurrent, fCurrent.originalFilename || fCurrent.path);

    const totalPrior = Object.values(prior).reduce((a, b) => a + b, 0);
    const totalCurrent = Object.values(current).reduce((a, b) => a + b, 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        tbParsed: { prior, current },
        totals: { prior: totalPrior, current: totalCurrent }
      })
    };
  } catch (err) {
    console.error("readTrialBalances error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "TB read failed", details: String(err?.message || err) }) };
  }
};
