// netlify/functions/generateStatements.js
// Fast path: skip listModels and call Gemini directly.
// Adds an AbortController timeout so slow calls fail with a clear error.

const fetch = require("node-fetch"); // v2.6.7

// Choose your model once (no discovery call):
// Use your known-good model from your ListModels response.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// How long we let the Gemini call run before aborting (ms).
// Keep this under your Netlify function timeout. With timeout=26, ~20s is safe.
const GEMINI_FETCH_TIMEOUT_MS = 20000;

function buildPrompt({ framework, companyName, notes, priorText, tbParsed }) {
  return `
You are an expert ${framework} financial reporting assistant.
Generate a professional draft of current-year financial statements for ${companyName}.
Use the style of the prior report, and map amounts from the TBs. Flag missing disclosures.

Inputs:
- Prior-year report text (style source, truncated):
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
}

async function generateWithGemini({ apiKey, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Abort the fetch if it takes too long
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEMINI_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }]}] }),
      signal: controller.signal
    });

    const txt = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        error: `Gemini HTTP ${res.status} ${res.statusText}`,
        endpoint,
        responseBody: txt
      };
    }

    // Try to parse the candidate text
    try {
      const data = JSON.parse(txt);
      const first = (data.candidates || [])[0] || {};
      const parts = first.content?.parts || [];
      const textPart = parts.find(p => typeof p.text === "string");
      return { ok: true, output: textPart?.text || "No text generated.", model };
    } catch (e) {
      return { ok: false, error: "Gemini JSON parse failed", endpoint, responseBody: txt };
    }
  } catch (err) {
    // Distinguish aborts
    if (err && (err.name === "AbortError" || String(err).includes("AbortError"))) {
      return { ok: false, error: `Gemini request aborted after ${GEMINI_FETCH_TIMEOUT_MS}ms`, endpoint };
    }
    return { ok: false, error: `Gemini fetch failed: ${err?.message || String(err)}`, endpoint };
  } finally {
    clearTimeout(t);
  }
}

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Invalid JSON request body" }) }; }

    const {
      framework = "IFRS",
      companyName = "the company",
      notes = "",
      priorText = "",
      tbParsed = {}
    } = body;

    if (!priorText || !tbParsed || !tbParsed.prior || !tbParsed.current) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required data (priorText and tbParsed)." })
      };
    }

    const prompt = buildPrompt({ framework, companyName, notes, priorText, tbParsed });
    const result = await generateWithGemini({ apiKey, model: MODEL, prompt });

    if (!result.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Gemini generation failed",
          modelTried: MODEL,
          endpoint: result.endpoint,
          details: result.error,
          responseBody: result.responseBody || ""
        })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output: result.output, model: MODEL })
    };
  } catch (err) {
    console.error("generateStatements fatal:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) }) };
  }
};








