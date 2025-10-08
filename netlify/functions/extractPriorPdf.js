// netlify/functions/extractPriorPdf.js
// POST JSON: { priorPdfBase64: "..." }  OR multipart/form-data with 'priorPdf' file
// -> { text: "..." }

const pdfParse = require("pdf-parse");
const multiparty = require("multiparty");
const fs = require("fs");

function isJson(event) {
  const ct = (event.headers && (event.headers["content-type"] || event.headers["Content-Type"])) || "";
  return ct.includes("application/json");
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    const bodyBuffer = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    // Very small shim to satisfy multiparty
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    let pdfBuffer;

    if (isJson(event)) {
      let payload = {};
      try { payload = JSON.parse(event.body || "{}"); } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }
      const b64 = payload.priorPdfBase64;
      if (!b64 || typeof b64 !== "string") {
        return { statusCode: 400, body: JSON.stringify({ error: "Expected a base64-encoded PDF body (priorPdfBase64)" }) };
      }
      try { pdfBuffer = Buffer.from(b64, "base64"); }
      catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid base64 PDF data" }) }; }
    } else {
      try {
        const { files } = await parseMultipart(event);
        const file = files?.priorPdf?.[0];
        if (!file?.path) {
          return { statusCode: 400, body: JSON.stringify({ error: "Expected multipart with a 'priorPdf' file" }) };
        }
        pdfBuffer = fs.readFileSync(file.path);
      } catch (err) {
        return { statusCode: 400, body: JSON.stringify({ error: "Failed to parse multipart", details: String(err?.message || err) }) };
      }
    }

    if (!pdfBuffer?.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Empty PDF buffer" }) };
    }

    const result = await pdfParse(pdfBuffer);
    const text = (result.text || "").trim();
    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (err) {
    console.error("extractPriorPdf error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Extraction failed", details: String(err?.message || err) }) };
  }
};










