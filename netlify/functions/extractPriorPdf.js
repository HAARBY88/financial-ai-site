// netlify/functions/extractPriorPdf.js
import multiparty from "multiparty";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = { api: { bodyParser: false } };

function parseMultipart(event) {
  const form = new multiparty.Form();
  return new Promise((resolve, reject) => {
    form.parse(event, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };
  try {
    const { files } = await parseMultipart(event);
    if (!files?.priorPdf?.[0]?.path) {
      return { statusCode:400, body: JSON.stringify({ error:"No priorPdf file uploaded" }) };
    }
    const filePath = files.priorPdf[0].path;
    const buf = fs.readFileSync(filePath);
    const parsed = await pdfParse(buf);
    const text = parsed.text || "";
    return {
      statusCode:200,
      body: JSON.stringify({
        preview: text.slice(0, 1500) + (text.length > 1500 ? "…" : ""),
        fullText: text
      })
    };
  } catch (err) {
    console.error("extractPriorPdf error:", err);
    return { statusCode:500, body: JSON.stringify({ error:"Failed to parse PDF", details: err.message }) };
  }
}

  }
};

