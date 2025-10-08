// netlify/functions/generateStatements.js
// Gemini v1 REST with robust diagnostics

const fetch = require("node-fetch"); // v2.6.7

function normalize(name = "") { return name.replace(/^models\//i, ""); }

async function listModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const txt = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `ListModels HTTP ${res.status} ${res.statusText}`,
      body: txt
    };
  }
  let models = [];
  try {
    const data = JSON.parse(txt);
    const arr = Array.isArray(data) ? data : (data.models || []);
    models = arr.map(m => ({ id: normalize(m?.name || m?.model || ""), raw: m })).filter(m => m.id);
  } catch (e) {
    return { ok: false, error: "ListModels JSON parse failed", body: txt };
  }
  return { ok: true, models };
}

async function generateWithModel({ apiKey, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }]}] });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  const txt = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `Gemini HTTP ${res.status} ${res.statusText}`,
      endpoint,
      body: txt
    };
  }

  try {
    const data = JSON.parse(txt);
    const first = (data.candidates || [])[0] || {};
    const parts = first.content?.parts || [];
    const textPart = parts.find(p => typeof p.text === "string");
    return { ok: true, text: textPart?.text || "No text generated.", endpoint };
  } catch (e) {
    return { ok: false, error: "Gemini JSON parse failed", endpoint, body: txt };
  }
}

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing GEMINI_API_KEY" })
      };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (e) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON request body" })
      };
    }

    const { framework = "IFRS", companyName = "the company", notes = "", priorText = "", tbParsed = {} } = body;

    if (!priorText || !tbParsed || !tbParsed.prior || !tbParsed.current) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required data (priorText and tbParsed)." })
      };
    }

    // 1) list models for this key
    const lm = await listModels(apiKey);
    if (!lm.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Failed to list models",
          details: lm.error,
          responseBody: lm.body || ""
        })
      };
    }

    // 2) filter usable (must support generateContent)
    const supportsGenerate = (m) => {
      const methods = m.raw?.supportedGenerationMethods || m.raw?.supportedMethods || [];
      return Array.isArray(methods) ? methods.includes("generateContent") : true;
    };
    const usable = lm.models.filter(supportsGenerate).map(m => m.id);

    if (!usable.length) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No usable models for this API key.",
          modelsAvailable: lm.models.map(m => m.id)
        })
      };
    }

    // 3) choose preferred first
    const preferredOrder = [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash-lite"
    ];
    const sorted = [...preferredOrder.filter(id => usable.includes(id)), ...usable.filter(id => !preferredOrder.includes(id))];
    const modelToUse = sorted[0];

    // 4) build prompt
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

    // 5) generate
    const gen = await generateWithModel({ apiKey, model: modelToUse, prompt });
    if (!gen.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Gemini generation failed",
          modelTried: modelToUse,
          endpoint: gen.endpoint,
          details: gen.error,
          responseBody: gen.body || ""
        })
      };
    }

    // success
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output: gen.text, model: modelToUse })
    };
  } catch (err) {
    console.error("generateStatements fatal:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) })
    };
  }
};









