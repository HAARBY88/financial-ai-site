import pdfParse from "pdf-parse";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!event.isBase64Encoded) {
      return { statusCode: 400, body: JSON.stringify({ error: "Expected base64-encoded PDF" }) };
    }

    const buffer = Buffer.from(event.body, "base64");
    const parsed = await pdfParse(buffer);
    const text = parsed.text || "";

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "PDF extracted successfully",
        preview: text.slice(0, 1500),
        fullText: text,
      }),
    };
  } catch (error) {
    console.error("extractPriorPdf error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to extract text from PDF" }) };
  }
}








