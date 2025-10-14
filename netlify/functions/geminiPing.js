import { GoogleGenAI } from "@google/genai";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

export async function handler() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json(500, { ok: false, error: "Missing GEMINI_API_KEY" });

    const modelName = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";
    const ai = new GoogleGenAI({ apiKey });

    const res = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: "Say hello from Gemini." }] }],
    });

    // @google/genai returns output_text for convenience
    const output = res.output_text ?? "(no text)";

    return json(200, { ok: true, model: modelName, output });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
