// netlify/functions/processUpload.js
import OpenAI from "openai";
import fetch from "node-fetch";
import pdfParse from "pdf-parse";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse request body (FormData sent by frontend)
    const formData = new URLSearchParams(event.body);

    const topic = formData.get("topic") || "General Accounting Analysis";
    const userQuestion = formData.get("question") || "";

    const filings = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("file")) filings.push(value);
    }

    if (filings.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No filings selected" }) };
    }

    // Companies House API key
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing Companies House API key" }) };
    }
    const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

    // Fetch and parse filings
    let combinedText = "";
    for (const metaUrl of filings) {
      try {
        // Get metadata
        const metaRes = await fetch(metaUrl, { headers: { Authorization: authHeader } });
        const metaData = await metaRes.json();

        // Find document content link
        let contentUrl = null;
        if (metaData.links?.document) {
          contentUrl = `https://document-api.company-information.service.gov.uk${metaData.links.document}/content`;
        } else if (metaData.links?.self) {
          contentUrl = `https://document-api.company-information.service.gov.uk${metaData.links.self}/content`;
        }

        if (!contentUrl) continue;

        // Fetch PDF
        const res = await fetch(contentUrl, { headers: { Authorization: authHeader } });
        if (!res.ok) continue;

        const buffer = await res.buffer();
        const pdfData = await pdfParse(buffer);
        combinedText += `\n\n--- Filing ---\n\n${pdfData.text}`;
      } catch (err) {
        console.error("⚠️ Filing fetch error:", err);
      }
    }

    if (!combinedText) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text could be extracted" }) };
    }

    // If no AI key, return debug
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: "⚠️ AI not enabled (missing OPENAI_API_KEY)",
          extracted: combinedText.slice(0, 2000)
        })
      };
    }

    // Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const messages = [
      { role: "system", content: "You are an expert in IFRS and US GAAP." },
      { role: "user", content: `Company filings:\n${combinedText}` },
      { role: "user", content: `Focus on topic: ${topic}` }
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
      body: JSON.stringify({
        output: response.choices[0].message.content,
        extracted: combinedText.slice(0, 2000)
      })
    };

  } catch (err) {
    console.error("❌ Processing error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}




