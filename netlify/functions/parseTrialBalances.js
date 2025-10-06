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
    const val = parseFloat((r[amtCol] || "0").toString().replace(/,/g, "")) || 0;
    if (key) result[key] = val;
  }
  return result;
}

export async function handler(event) {
  try {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const boundaryMatch = contentType?.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing multipart boundary" }) };
    }

    const boundary = boundaryMatch[1];
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);

    const parts = multipart.Parse(bodyBuffer, boundary);
    const prior = parts.find(p => p.name === "tbPrior");
    const current = parts.find(p => p.name === "tbCurrent");

    if (!prior || !current) {
      return { statusCode: 400, body: JSON.stringify({ error: "Both tbPrior and tbCurrent required" }) };
    }

    const priorRows = sheetToObj(prior.data);
    const currRows = sheetToObj(current.data);
    const tbParsed = {
      prior: toKeyValue(priorRows),
      current: toKeyValue(currRows),
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        summary: `Parsed TBs: Prior ${Object.keys(tbParsed.prior).length} accounts, Current ${Object.keys(tbParsed.current).length} accounts.`,
        tbParsed,
      }),
    };
  } catch (error) {
    console.error("parseTrialBalances error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse Excel", details: error.message }) };
  }
}












