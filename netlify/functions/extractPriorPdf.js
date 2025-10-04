// netlify/functions/extractPriorPdf.js (CommonJS + parse-multipart)
const pdfParse = require("pdf-parse");
const multipart = require("parse-multipart");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Get content-type and boundary
    const contentType =
      event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "";
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing multipart boundary" }) };
    }
    const boundary = boundaryMatch[1];

    // Decode body to Buffer
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    // Parse parts
    const parts = multipart.Parse(bodyBuffer, boundary);
    if (!Array.isArray(parts) || parts.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No multipart parts found" }) };
    }

    // Find the 'priorPdf' file part
    const priorPdfPart = parts.find(
      (p) =>
        p.filename &&
        (p.name === "priorPdf" || /priorpdf/i.test(p.name || ""))
    );
    if (!priorPdfPart) {
      return { statusCode: 400, body: JSON.stringify({ error: "No priorPdf file uploaded" }) };
    }

    // priorPdfPart.data is a Buffer of the file content
    const parsed = await pdfParse(priorPdfPart.data);
    const text = parsed.text || "";

    return {
      statusCode: 200,
      body: JSON.stringify({
        preview: text.slice(0, 1500) + (text.length > 1500 ? "…" : ""),
        fullText: text
      })
    };
  } catch (err) {
    console.error("extractPriorPdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to parse PDF", details: err.message })
    };
  }
};





