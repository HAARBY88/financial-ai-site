// netlify/functions/processUpload.js
import multiparty from "multiparty";
import fs from "fs";
import pdfParse from "pdf-parse";
import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Required so Netlify doesn't try to parse multipart automatically
export const config = { api: { bodyParser: false } };

async function fetchPdfToBuffer(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to download PDF (${res.status}): ${txt}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function parseMultipart(event) {
  const form = new multiparty.Form();
  return new Promise((resolve, reject) => {
    form.parse(event, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function getHeader(headers, name) {
  if (!headers) return "";
  const k = Object.keys(headers).find(
    (h) => h.toLowerCase() === name.toLowerCase()
  );
  return k ? headers[k] : "";
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1) Work out how the caller sent data
    const contentType = getHeader(event.headers, "content-type") || "";

    // These will be filled whichever path we take
    let framework = "IFRS";
    let topic = "General Accounting";
    let question = "";
    let extractedText = "";

    if (contentType.includes("application/json")) {
      // --- JSON body path (e.g., when front end sends { pdfUrl, topic, question })
      const body = JSON.parse(event.body || "{}");
      framework = body.framework || framework;
      topic = body.topic || topic;
      question = body.question || "";

      if (!body.pdfUrl) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "pdfUrl is required for JSON requests" }),
        };
      }

      const pdfBuffer = await fetchPdfToBuffer(body.pdfUrl);
      const parsed = await pdfParse(pdfBuffer);
      extractedText = parsed.text || "";

    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // --- URL-encoded path (works with form posts without files)
      const params = new URLSearchParams(event.body || "");
      framework = params.get("framework") || framework;
      topic = params.get("topic") || topic;
      question = params.get("question") || "";
      const pdfUrl = params.get("pdfUrl");

      if (!pdfUrl) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "pdfUrl is required for urlencoded requests" }),
        };
      }

      const pdfBuffer = await fetchPdfToBuffer(pdfUrl);
      const parsed = await pdfParse(pdfBuffer);
      extractedText = parsed.text || "";

    } else if (contentType.includes("multipart/form-data")) {
      // --- Multipart path (user uploaded a file through <input type="file" name="statement" />)
      const { fields, files } = await parseMultipart(event);

      framework = fields?.framework?.[0] || framework;
      topic = fields?.topic?.[0] || topic;
      question = fields?.question?.[0] || "";

      if (files?.statement?.[0]?.path) {
        const filePath = files.statement[0].path;
        const fileData = fs.readFileSync(filePath);
        const parsed = await pdfParse(fileData);
        extractedText = parsed.text || "";
      } else if (fields?.pdfUrl?.[0]) {
        // Also support pdfUrl in multipart (no file chosen, but a PDF URL provided)
        const pdfBuffer = await fetchPdfToBuffer(fields.pdfUrl[0]);
        const parsed = await pdfParse(pdfBuffer);
        extractedText = parsed.text || "";
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error:
              "No file uploaded (statement) and no pdfUrl provided in multipart form",
          }),
        };
      }
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Unsupported content-type. Use JSON (with pdfUrl), urlencoded (with pdfUrl), or multipart (with statement or pdfUrl).",
        }),
      };
    }

    if (!extractedText.trim()) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: "Could not extract text from the PDF",
        }),
      };
    }

    // 2) Send to Gemini
    if (!process.env.GEMINI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Prompt includes framework + topic + (optional) user question + financial text
    const prompt = `
You are a professional ${framework} accounting expert.
Task: Analyse the company's financial statements and address the user's request.

Topic of interest: ${topic}
User question (if any): ${question || "(none provided)"}

Financial statements (extracted text follows between <<< >>>):
<<<
${extractedText}
>>>

Output requirements:
- Use ${framework} principles.
- Be specific and cite relevant sections of the statements when possible (by quoting short phrases).
- If the statements do not contain enough information, say what is missing and what should be disclosed.
`;

    const result = await model.generateContent(prompt);
    const answer = result?.response?.text?.() || "No response from AI.";

    return {
      statusCode: 200,
      body: JSON.stringify({
        output: answer,
        preview: extractedText.slice(0, 1200) + (extractedText.length > 1200 ? "..." : ""),
      }),
    };
  } catch (err) {
    console.error("processUpload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Processing failed", details: err.message }),
    };
  }
}








