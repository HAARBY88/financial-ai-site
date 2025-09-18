import multiparty from "multiparty";
import fs from "fs";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Disable Netlify’s default body parsing (needed for file uploads)
export const config = { api: { bodyParser: false } };

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse the incoming multipart form (file + fields)
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // Validate file input
    if (!formData.files || !formData.files.statement) {
      return { statusCode: 400, body: JSON.stringify({ error: "No file uploaded" }) };
    }

    // Extract uploaded file
    const filePath = formData.files.statement[0].path;
    const fileData = fs.readFileSync(filePath);

    // Convert PDF to text
    const pdfText = await pdfParse(fileData);
    const extractedText = pdfText.text;

    // Extract form fields
    const framework = formData.fields.framework ? formData.fields.framework[0] : "IFRS/US GAAP";
    const topic = formData.fields.topic ? formData.fields.topic[0] : "General Accounting";

    // 🔑 Initialise Gemini
    if (!process.env.GEMINI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Create prompt
    const prompt = `
      You are an expert in ${framework} accounting.
      Analyse the following financial data and explain ${topic} in detail:

      ${extractedText}
    `;

    // Send to Gemini
    const result = await model.generateContent(prompt);

    let output = "No response from AI.";
    if (result?.response) {
      output = result.response.text();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        output,
        extracted: extractedText.slice(0, 1000) + "...", // only preview first 1000 chars
      }),
    };

  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Processing failed",
        details: err.message,
      }),
    };
  }
}







