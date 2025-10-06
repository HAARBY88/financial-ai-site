// netlify/functions/extractPriorPdf.js
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";

export const config = {
  api: {
    bodyParser: false, // Let us handle raw binary
  },
};

export async function handler(event) {
  try {
    // Step 1: Ensure it's a POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

    // Step 2: Decode multipart manually
    // Netlify sends Base64 when binary
    if (!event.isBase64Encoded) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Expected Base64-encoded PDF" }),
      };
    }

    // Step 3: Convert base64 → Buffer
    const pdfBuffer = Buffer.from(event.body, "base64");

    // Step 4: Parse the PDF
    const pdfData = await pdfParse(pdfBuffer);

    // Step 5: Return extracted text
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "PDF extracted successfully",
        extractedText: pdfData.text.substring(0, 2000) + "...", // limit output
      }),
    };
  } catch (error) {
    console.error("extractPriorPdf error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to extract text from PDF" }),
    };
  }
}






