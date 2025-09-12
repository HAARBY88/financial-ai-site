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

// Helper: extract relevant IFRS section
function getIFRSSection(topic) {
  if (!ifrsSummary || !topic) return "";
  const lowerText = ifrsSummary.toLowerCase();
  const lowerTopic = topic.toLowerCase();
  const idx = lowerText.indexOf(lowerTopic);
  if (idx === -1) {
    return ifrsSummary.slice(0, 2000); // fallback: first 2000 chars
  }
  const start = Math.max(0, idx - 1000);
  const end = Math.min(ifrsSummary.length, idx + 3000);
  return ifrsSummary.slice(start, end);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse form submission
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields) => {
        if (err) reject(err);
        else resolve({ fields });
      });
    });

    const topic = formData.fields.topic ? formData.fields.topic[0] : "General Accounting Analysis";
    const userQuestion = formData.fields.question ? formData.fields.question[0] : "";

    // Collect selected filings (metadata URLs)
    const filings = Object.keys(formData.fields)
      .filter(k => k.startsWith("file"))
      .map(k => formData.fields[k][0]);

    if (filings.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No filings selected" }) };
    }

    // Build Companies House auth header
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing Companies House API key" }) };
    }
    const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

    // Fetch and parse filings
    let combinedText = "";
    for (const metaUrl of filings) {
      try {
        // Fetch metadata first
        const metaRes = await fetch(metaUrl, { headers: { Authorization: authHeader } });
        if (!metaRes.ok) {
          console.error(`⚠️ Failed to fetch metadata: ${metaUrl}`, await metaRes.text());
          continue;
        }
        const metaData = await metaRes.json();

        // Get document content URL
        let contentUrl = null;
        if (metaData.links?.document) {
          contentUrl = `https://document-api.company-information.service.gov.uk${metaData.links.document}/content`;
        } else if (metaData.links?.self) {
          contentUrl = `https://document-api.company-information.service.gov.uk${metaData.links.self}/content`;
        }

        if (!contentUrl) {
          console.error("⚠️ No document content URL in metadata:", metaData);
          continue;
        }

        // Fetch the actual PDF
        const res = await fetch(contentUrl, { headers: { Authorization: authHeader } });
        if (!res.ok) {
          console.error(`⚠️ Failed to fetch document content: ${contentUrl}`, await res.text());
          continue;
        }
        const buffer = await res.buffer();
        const pdfData = await pdfParse(buffer);
        combinedText += `\n\n--- Filing from ${contentUrl} ---\n\n${pdfData.text}`;
      } catch (err) {
        console.error("⚠️ Error fetching/parsing filing:", err);
      }
    }

    if (!combinedText) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text could be extracted from filings" }) };
    }

    // Extract relevant IFRS section
    const ifrsSection = getIFRSSection(topic);

    // If AI key missing, return raw text for debugging
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 200,
        body: JSON.stringify({ output: `Debug Mode: No AI key.\n\nExtracted filings:\n${combinedText.slice(0, 1000)}...` })
      };
    }

    // Send to OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages = [
      { role: "system", content: "You are an expert accountant skilled in IFRS and US GAAP." },
      { role: "user", content: `Relevant IFRS section for '${topic}':\n${ifrsSection}` },
      { role: "user", content: `Company filings:\n${combinedText}` },
      { role: "user", content: `Focus on topic: ${topic}.` }
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
    console.error("❌ Processing error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Processing failed", details: err.message }) };
  }
}




