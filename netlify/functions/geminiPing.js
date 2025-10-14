// netlify/functions/geminiPing.js
import { GoogleGenerativeAI } from "@google/genai";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

export async function handler() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json(500, { error: "Missing GEMINI_API_KEY" });

    const modelName = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";
    const client = new GoogleGenerativeAI({ apiKey });
    const model = client.getGenerativeModel({ model: modelName });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello from Gemini." }] }],
    });

    const output =
      result.output_text ??
      result.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") ??
      "(no text)";

    return json(200, { ok: true, model: modelName, output });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
