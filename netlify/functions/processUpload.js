import OpenAI from "openai";
import multiparty from "multiparty";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = { api: { bodyParser: false } };

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const form = new multiparty.Form();
    const formData = await new Promise((resolve, reject) => {
      form.parse(event, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const filePath = formData.files.statement[0].path;
    const fileData = fs.readFileSync(filePath);
    const pdfText = await pdfParse(fileData);
    const extractedText = pdfText.text;

    const framework = formData.fields.framework[0];
    const topic = formData.fields.topic[0];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are an expert in ${framework} accounting.` },
        { role: "user", content: `Analyse the following financial data and explain ${topic}:\n${extractedText}` }
      ]
    });

    return { statusCode: 200, body: JSON.stringify({ output: response.choices[0].message.content }) };
  } catch (err) {
    console.error("Upload error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Processing failed." }) };
  }
}
