import multiparty from "multiparty";
import fs from "fs";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Tell Netlify not to parse automatically
export const config = { api: { bodyParser: false } };

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // --- Parse uploaded form data
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // --- Get PDF file
    const filePath = formData.files.statement[0].path;
    const fileData = fs.readFileSync(filePath);
    const pdfText = await pdfParse(fileData);
    const extractedText = pdfText.text;

    // --- Get fields from the form
    const framework = formData.fields.framework ? formData.fields.framework[0] : "IFRS";
    const topic = formData.fields.topic ? formData.fields.topic[0] : "General accounting";

    // --- Init Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // --- Build prompt
    const prompt = `
      You are an expert in ${framework} accounting.
      Analyse the following financial data and explain ${topic}:

      ${extractedText}
    `;

    // --- Ask Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return {
      statusCode: 200,
      body: JSON.stringify({
        extracted: extractedText.slice(0, 2000), // first 2k chars for debug
        output: text
      })
    };

  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Processing failed.", details: err.message })
    };
  }
}








