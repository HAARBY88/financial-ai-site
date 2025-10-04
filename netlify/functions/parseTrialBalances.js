// netlify/functions/parseTrialBalances.js
import multiparty from "multiparty";
import fs from "fs";
import XLSX from "xlsx";

export const config = { api: { bodyParser: false } };

function parseMultipart(event) {
  const form = new multiparty.Form();
  return new Promise((resolve, reject) => {
    form.parse(event, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function readFirstSheetToRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }); // array of rows (objects)
}

// very basic guess: look for columns like "Account" and "Amount"
function toKeyValue(rows) {
  // try to detect possible columns
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const accountCol = columns.find(c => /account/i.test(c)) || columns[0];
  const amountCol  = columns.find(c => /(amount|balance|value)/i.test(c)) || columns[1];

  const out = {};
  rows.forEach(r => {
    const key = String(r[accountCol] || "").trim();
    const valRaw = r[amountCol];
    const val = typeof valRaw === "number" ? valRaw : parseFloat(String(valRaw).replace(/[, ]/g,""));
    if (key) out[key] = isNaN(val) ? 0 : val;
  });
  return out;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };
  try {
    const { files } = await parseMultipart(event);
    if (!files?.tbPrior?.[0]?.path || !files?.tbCurrent?.[0]?.path) {
      return { statusCode:400, body: JSON.stringify({ error:"Please upload both tbPrior and tbCurrent Excel files" }) };
    }

    const priorRows   = readFirstSheetToRows(files.tbPrior[0].path);
    const currentRows = readFirstSheetToRows(files.tbCurrent[0].path);

    const priorKV   = toKeyValue(priorRows);
    const currentKV = toKeyValue(currentRows);

    const priorSum   = Object.values(priorKV).reduce((a,b)=>a+b,0);
    const currentSum = Object.values(currentKV).reduce((a,b)=>a+b,0);

    return {
      statusCode:200,
      body: JSON.stringify({
        summary: `Parsed TBs. Accounts (prior: ${Object.keys(priorKV).length}, current: ${Object.keys(currentKV).length}). Sums (prior: ${priorSum.toFixed(2)}, current: ${currentSum.toFixed(2)}).`,
        tbParsed: { prior: priorKV, current: currentKV }
      })
    };
  } catch (err) {
    console.error("parseTrialBalances error:", err);
    return { statusCode:500, body: JSON.stringify({ error:"Failed to parse TBs", details: err.message }) };
  }
}





