// netlify/functions/parseTrialBalances.js (CommonJS + parse-multipart)
const XLSX = require("xlsx");
const multipart = require("parse-multipart");

function readFirstSheetToRowsFromBuffer(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function toKeyValue(rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const accountCol = columns.find((c) => /account/i.test(c)) || columns[0];
  const amountCol = columns.find((c) => /(amount|balance|value|debit|credit)/i.test(c)) || columns[1];

  const out = {};
  rows.forEach((r) => {
    const key = String(r[accountCol] || "").trim();
    const raw = r[amountCol];
    const val =
      typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[, ]/g, ""));
    if (key) out[key] = isNaN(val) ? 0 : val;
  });
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const contentType =
      event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "";
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing multipart boundary" }) };
    }
    const boundary = boundaryMatch[1];

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    const parts = multipart.Parse(bodyBuffer, boundary);
    if (!Array.isArray(parts) || parts.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No multipart parts found" }) };
    }

    // Find files by field name
    const priorPart = parts.find(
      (p) => p.filename && (p.name === "tbPrior" || /tbprior/i.test(p.name || ""))
    );
    const currentPart = parts.find(
      (p) => p.filename && (p.name === "tbCurrent" || /tbcurrent/i.test(p.name || ""))
    );

    if (!priorPart || !currentPart) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Please upload both tbPrior and tbCurrent Excel files" })
      };
    }

    const priorRows = readFirstSheetToRowsFromBuffer(priorPart.data);
    const currentRows = readFirstSheetToRowsFromBuffer(currentPart.data);

    const priorKV = toKeyValue(priorRows);
    const currentKV = toKeyValue(currentRows);

    const sum = (obj) => Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
    const priorSum = sum(priorKV);
    const currentSum = sum(currentKV);

    return {
      statusCode: 200,
      body: JSON.stringify({
        summary: `Parsed TBs. Accounts (prior: ${Object.keys(priorKV).length}, current: ${Object.keys(currentKV).length}). Sums (prior: ${priorSum.toFixed(2)}, current: ${currentSum.toFixed(2)}).`,
        tbParsed: { prior: priorKV, current: currentKV }
      })
    };
  } catch (err) {
    console.error("parseTrialBalances error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to parse TBs", details: err.message })
    };
  }
};











