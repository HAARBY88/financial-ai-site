import XLSX from "xlsx";
import multipart from "parse-multipart";

function sheetToObj(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function toKeyValue(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const accCol = cols.find(c => /account/i.test(c)) || cols[0];
  const amtCol = cols.find(c => /(amount|balance|value|debit|credit)/i.test(c)) || cols[1];
  const result = {};
  for (const r of rows) {
    const key = (r[accCol] || "").toString().trim();
    const raw = (r[amtCol] ?? "").toString().replace(/,/g, "");
    const val = parseFloat(raw);
    if (key) result[key] = isNaN(val) ? 0 : val;
  }
  return result;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const boundaryMatch = contentType?.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing multipart boundary" }) };
    }

    const boundary = boundaryMatch[1];
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    const parts = multipart.Parse(bodyBuffer, boundary) || [];
    const fileParts = parts.filter(p => p.filename);

    // Try to find by expected names first
    let prior = fileParts.find(p => p.name === "tbPrior");
    let current = fileParts.find(p => p.name === "tbCurrent");

    // Fallback: if not found, try the first two files uploaded
    if (!prior || !current) {
      if (fileParts.length >= 2) {
        prior = prior || fileParts[0];
        current = current || fileParts[1];
      }
    }

    if (!prior || !current) {
      const received = parts.map(p => p.name || "(no name)").join(", ");
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Both tbPrior and tbCurrent required",
          receivedFields: received
        }),
      };
    }

    const priorRows = sheetToObj(prior.data);
    const currRows = sheetToObj(current.data);
    const priorKV = toKeyValue(priorRows);
    const currentKV = toKeyValue(currRows);

    const sum = (obj) => Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
    const priorSum = sum(priorKV);
    const currentSum = sum(currentKV);

    return {
      statusCode: 200,
      body: JSON.stringify({
        summary: `Parsed TBs. Accounts (prior: ${Object.keys(priorKV).length}, current: ${Object.keys(currentKV).length}). Sums (prior: ${priorSum.toFixed(2)}, current: ${currentSum.toFixed(2)}).`,
        tbParsed: { prior: priorKV, current: currentKV },
      }),
    };
  } catch (error) {
    console.error("parseTrialBalances error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse Excel", details: error.message }) };
  }
}












