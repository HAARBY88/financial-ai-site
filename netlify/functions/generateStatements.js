// netlify/functions/generateStatements.js
// Uses @google/genai (Gemini 2.5 multimodal) for text + PDF/Excel analysis

import { GoogleGenAI, createUserContent, createPartFromBuffer } from "@google/genai";
import multiparty from "multiparty";
import fs from "fs";

export const config = { api: { bodyParser: false } };

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse uploaded files and JSON fields
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const framework = fields.framework?.[0] || "IFRS";
    const companyName = fields.companyName?.[0] || "Unknown Company";
    const notes = fields.notes?.[0] || "";

    // Get uploaded files (PDF and/or Excel)
    const pdfFile = files?.priorPdf?.[0];
    const tbFile = files?.tbCurrent?.[0];

    if (!pdfFile && !tbFile) {
      return { statusCode: 400, body: JSON.stringify({ error: "Please upload at least one file." }) };
    }

    // Read and upload files to Gemini file storage
    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const uploads = [];
    if (pdfFile) {
      const pdfData = fs.readFileSync(pdfFile.path);
      const pdfUpload = await genAI.files.upload({
        file: pdfData,
        mimeType: "application/pdf",
        displayName: pdfFile.originalFilename,
      });
      uploads.push(createPartFromBuffer(pdfData, "application/pdf"));
    }
    if (tbFile) {
      const tbData = fs.readFileSync(tbFile.path);
      const tbUpload = await genAI.files.upload({
        file: tbData,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        displayName: tbFile.originalFilename,
      });
      uploads.push(createPartFromBuffer(tbData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    }

    const userPrompt = `
You are an expert ${framework} financial reporting assistant.
Using the uploaded documents, generate a draft set of financial statements for ${companyName}.
Focus on the structure, key notes, and presentation style. Apply ${framework} compliance and highlight missing disclosures.
Notes from user: ${notes}
`;

    // Combine text + file content in one multimodal request
    const response = await genAI.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [createUserContent([userPrompt, ...uploads])]
    });

    const text = response.text();
    return { statusCode: 200, body: JSON.stringify({ output: text }) };

  } catch (err) {
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gemini request failed", details: err.message })
    };
  }
}









