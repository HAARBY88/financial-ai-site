// Accepts: raw base64 body OR data: URL OR multipart form-data
import pdfParse from "pdf-parse";
import multipart from "parse-multipart";

function looksLikePDF(buf) {
  return buf && buf.length > 4 && buf.slice(0, 4).toString() === "%PDF";
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const headers = event.headers || {};
    const contentType = headers["content-type"] || headers["Content-Type"] || "";

    let pdfBuffer = null;

    // 1) If multipart: parse and pull the first file (or a field named priorPdf)
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64")
        : Buffer.from(event.body || "", "utf8");
      const parts = multipart.Parse(bodyBuffer, boundary) || [];
      const filePart =
        parts.find((p) => p.filename && (p.name === "priorPdf" || /priorpdf/i.test(p.name || ""))) ||
        parts.find((p) => p.filename);

      if (!filePart) {
        const received = parts.map((p) => p.name || "(no name)").join(", ");
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "No PDF file found in multipart body.",
            receivedFields: received
          }),
        };
      }
      pdfBuffer = filePart.data;
    }

    // 2) If not multipart: treat body as base64 (or data URL)
    if (!pdfBuffer) {
      let raw = event.body || "";

      // data URL support: data:application/pdf;base64,AAAA...
      if (raw.startsWith("data:")) {
        const idx = raw.indexOf("base64,");
        if (idx !== -1) raw = raw.slice(idx + "base64,".length);
      }

      // Try to decode as base64 regardless of isBase64Encoded flag
      try {
        pdfBuffer = Buffer.from(raw, "base64");
      } catch {
        pdfBuffer = null;
      }
    }

    // 3) Validate PDF magic header
    if (!pdfBuffer || !looksLikePDF(pdfBuffer)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Expected a base64-encoded PDF body (or multipart with a PDF file).",
          hint: "Send the file as base64 (no headers) OR use multipart FormData with field name 'priorPdf'."
        }),
      };
    }

    // 4) Parse and return a preview
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text || "";
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "PDF extracted successfully",
        preview: text.slice(0, 1500) + (text.length > 1500 ? "…" : ""),
        fullText: text
      }),
    };
  } catch (error) {
    console.error("extractPriorPdf error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to extract text from PDF" }) };
  }
}










