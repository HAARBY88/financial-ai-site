// netlify/functions/processUpload.js
import OpenAI from "openai";
import multiparty from "multiparty";
import fetch from "node-fetch";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = { api: { bodyParser: false } };

// Load IFRS "In Your Pocket" PDF once when function starts
let ifrsSummary = "";
(async () => {
  try {
    const pdfBuffer = fs.readFileSync("docs/ifrs-pocket-2024.pdf");
    const pdfData = await pdfParse(pdfBuffer);
    ifrsSummary = pdfData.text;
    console.log("✅ IFRS in Your Pocket loaded successfully.");
  } catch (err) {
    console.error("⚠️ Could not load IFRS PDF:", err);
  }
})();

// Helper: extract relevant section for chosen topic
function getIFRSSection(topic) {
  if (!ifrsSummary || !topic) return "";
  const lowerText = ifrsSummary.toLowerCase();
  const lowerTopic = topic.toLowerCase();
  const idx = lowerText.indexOf(lowerTopic);
  if (idx === -1) {
    return ifrsSummary.slice(0, 2000); // fallback: first 2000 chars
  }
  const start = Math.max(0, idx - 1000); // grab context before
  const end = Math.min(ifrsSummary.length, idx + 3000); // grab context after
  return ifrsSummary.slice(start, end);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse form submission (filing links + topic + question)
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields) => {
        if (err) reject(err);
        else resolve({ fields });
      });
    });

    const topic = formData.fields.topic ? formData.fields.topic[0] : "General Accounting Analysis";
    const userQuestion = formData.fields.question ? formData.fields.question[0] : "";

    // Collect selected filings
    const filings = Object.keys(formData.fields)
      .filter(k => k.startsWith("file"))
      .map(k => formData.fields[k][0]);

    if (filings.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No filings selected" }) };
    }

    // Build auth header for Companies House Document API
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing Companies House API key" }) };
    }
    const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

    // Fetch and parse each filing (PDF expected)
    let combinedText = "";
    for (const link of filings) {
      try {
        const res = await fetch(link, { headers: { Authorization: authHeader } });
        if (!res.ok) {
          console.error(`Failed to fetch document: ${link}`, await res.text());
          continue;
        }
        const buffer = await res.buffer();
        const pdfData = await pdfParse(buffer);
        combinedText += `\n\n--- Filing from ${link} ---\n\n${pdfData.text}`;
      } catch (err) {
        console.error("Error fetching/parsing filing:", err);
      }
    }

    if (!combinedText) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text could be extracted from filings" }) };
    }

    // Pick relevant IFRS section
    const ifrsSection = getIFRSSection(topic);

    // Send to OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages = [
      { role: "system", content: "You are an expert accountant skilled in IFRS and US GAAP." },
      { role: "user", content: `Here is the relevant section of IFRS (from 'IFRS in Your Pocket') for topic '${topic}':\n${ifrsSection}` },
      { role: "user", content: `Here are the company filings:\n${combinedText}` },
      { role: "user", content: `Focus on the topic: ${topic}.` }
    ];

    if (userQuestion) {
      messages.push({ role: "user", content: `Question: ${userQuestion}` });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ output: response.choices[0].message.content })
    };

  } catch (err) {
    console.error("Processing error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Processing failed", details: err.message }) };
  }
}


