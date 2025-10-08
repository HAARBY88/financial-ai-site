// netlify/functions/extractPriorPdf.js
// Accepts EITHER:
//  1) JSON: { priorPdfBase64: "..." }  (what your page sends)
//  2) multipart/form-data: field name "priorPdf" (fallback)
// Returns: { text: "extracted text ..." }

const pdfParse = require("pdf-parse");
const multiparty = require("multiparty");

function isJson(event) {
  const ct = (event.headers && (event.headers["content-type"] || event.headers["Content-Type"])) || "";
  return ct.includes("application/json");
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    // Netlify passes body as base64 string when binary
    const bodyBuffer = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    // multiparty expects a Node req-like object
    form.parse(
      {
        headers: event.headers,
        // minimal req shim
        on: (name, cb) => {
          if (name === "data") {
            cb(bodyBuffer);
          }
          if (name === "end") {
            cb();
          }
          return this;
        }
      },
      (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      }
    );
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    let pdfBuffer = null;

    if (isJson(event)) {
      // Path A: JSON with base64
      let payload = {};
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }
      const b64 = payload.priorPdfBase64;
      if (!b64 || typeof b64 !== "string") {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Expected a base64-encoded PDF in 'priorPdfBase64'."
          })
        };
      }
      try {
        pdfBuffer = Buffer.from(b64, "base64");
      } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid base64 PDF data" }) };
      }
    } else {
      // Path B: multipart with file
      try {
        const { files } = await parseMultipart(event);
        const file = files?.priorPdf?.[0];
        if (!file || !file.path) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              error: "Expected multipart upload with a 'priorPdf' file field."
            })
          };
        }
        const fs = require("fs");
        pdfBuffer = fs.readFileSync(file.path);
      } catch (err) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Failed to parse multipart form data",
            details: String(err?.message || err)
          })
        };
      }
    }

    // Basic sanity check
    if (!pdfBuffer || !pdfBuffer.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Empty PDF buffer" }) };
    }

    // Extract text
    const result = await pdfParse(pdfBuffer);
    const text = (result.text || "").trim();

    if (!text) {
      return { statusCode: 200, body: JSON.stringify({ text: "" }) };
    }

    // Return a manageable amount; frontend keeps only a preview anyway
    return {
      statusCode: 200,
      body: JSON.stringify({ text })
    };
  } catch (err) {
    console.error("extractPriorPdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Extraction failed", details: String(err?.message || err) })
    };
  }
};










