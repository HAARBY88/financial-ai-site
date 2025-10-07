// netlify/functions/generateStatements.js
// CommonJS + dynamic ESM import for the Gemini SDK

async function getGemini() {
  const mod = await import("@google/generative-ai");
  return mod;
}

async function tryModel({ GoogleGenerativeAI }, apiKey, modelId, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });
  const res = await model.generateContent(prompt);
  const out = await res.response?.text?.();
  return out || "No output generated.";
}

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    // Prefer your env override; otherwise use current v1 “latest” aliases
    const candidates = [
      process.env.GEMINI_MODEL,              // optional override
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest"
    ].filter(Boolean);

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const {
      framework = "IFRS",
      companyName = "the company",
      notes = "",
      priorText = "",
      tbParsed = {}
    } = body;

    if (!priorText || !tbParsed || !Object.keys(tbParsed).length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required data (priorText and tbParsed)." })
      };
    }

    const prompt = `
You are an expert ${framework} financial reporting assistant.
Generate a professional draft of current-year financial statements for ${companyName}.
Use the style of the prior report, and map amounts from the TBs. Flag missing disclosures.

Inputs:
- Prior-year report text (style source):
${(priorText || "").slice(0, 12000)}

- Current trial balance:
${JSON.stringify(tbParsed.current || {}, null, 2)}

- Prior trial balance:
${JSON.stringify(tbParsed.prior || {}, null, 2)}

- Notes from user:
${notes}

Output sections:
1) Statement of Profit or Loss (with comparatives)
2) Statement of Financial Position (with comparatives)
3) Key accounting policies (brief)
4) Key notes (revenue, leases, instruments, PPE/intangibles)
5) Missing disclosures list
Keep the tone concise and professional and align to ${framework}.
`.trim();

    const { GoogleGenerativeAI } = await getGemini();
    const genAI = new GoogleGenerativeAI(apiKey);

    // Try candidates in order
    let lastErr = null;
    for (const modelId of candidates) {
      try {
        const text = await tryModel({ GoogleGenerativeAI }, apiKey, modelId, prompt);
        return { statusCode: 200, body: JSON.stringify({ output: text, model: modelId }) };
      } catch (err) {
        const msg = (err && (err.message || String(err))) || "";
        // Log and try next
        console.error(`Model "${modelId}" failed:`, msg);
        lastErr = err;
        continue;
      }
    }

    // If all failed, list models available to your key and return them to help selection
    let modelsAvailable = [];
    try {
      const listed = await genAI.listModels?.();
      // Some SDK versions return {models:[...]}, others an array
      const arr = Array.isArray(listed) ? listed : (listed?.models || []);
      modelsAvailable = arr.map(m => m?.name || m?.model || m).filter(Boolean);
    } catch (e) {
      console.error("listModels failed:", e?.message || e);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: (lastErr && (lastErr.message || String(lastErr))) || "All models unavailable",
        tried: candidates,
        modelsAvailable
      })
    };
  } catch (err) {
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) })
    };
  }
};









