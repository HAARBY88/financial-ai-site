// netlify/functions/generateStatements.js
// CommonJS function that calls the Gemini v1 REST API directly (no SDK needed).

/**
 * POST https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key=API_KEY
 * Body shape:
 * {
 *   contents: [{ role: "user", parts: [{ text: "your prompt" }] }]
 * }
 */

const DEFAULT_MODELS = [
  // try an explicit env override first (if set)
  // then current v1 "latest" aliases:
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  // and a conservative older fallback that usually exists:
  "gemini-pro"
];

async function callGeminiREST({ apiKey, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}]
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    const error = new Error(`Gemini HTTP ${res.status}: ${txt}`);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  // Safely extract text
  const candidates = data.candidates || [];
  const first = candidates[0] || {};
  const parts = first.content?.parts || [];
  const textPart = parts.find(p => typeof p.text === "string");
  return textPart?.text || "No text generated.";
}

async function listModelsREST(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    // Some responses are { models: [...] }, some may be arrays—handle both:
    const arr = Array.isArray(data) ? data : (data.models || []);
    return arr.map(m => m?.name || m?.model).filter(Boolean);
  } catch {
    return [];
  }
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

    // Read preferred model from env, otherwise use defaults
    const candidates = [
      process.env.GEMINI_MODEL,
      ...DEFAULT_MODELS
    ].filter(Boolean);

    // Parse input
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

    let lastErr = null;
    for (const model of candidates) {
      try {
        const output = await callGeminiREST({ apiKey, model, prompt });
        return {
          statusCode: 200,
          body: JSON.stringify({ output, model })
        };
      } catch (err) {
        // If 404, try the next model; otherwise bubble up immediately
        const msg = err && (err.message || String(err));
        const is404 = /404/.test(String(err.status)) || /not found/i.test(msg);
        if (!is404) {
          console.error(`Model "${model}" error:`, msg);
          return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate", modelTried: model, details: msg }) };
        }
        // try next
        lastErr = err;
      }
    }

    // All tried models failed — list what's actually available with your key
    const modelsAvailable = await listModelsREST(apiKey);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: lastErr?.message || "All models unavailable for your key/region.",
        tried: candidates,
        modelsAvailable
      })
    };
  } catch (err) {
    console.error("generateStatements fatal error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) })
    };
  }
};











