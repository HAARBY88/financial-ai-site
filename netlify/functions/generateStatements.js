// netlify/functions/generateStatements.js
// CommonJS wrapper + dynamic ESM import for the Gemini SDK

async function getGemini() {
  // ESM import works fine inside CommonJS on Netlify
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

    // Allow an explicit model via env; otherwise try a list in order.
    const candidates = [
      process.env.GEMINI_MODEL,
      "gemini-1.5-flash-002",
      "gemini-1.5-pro-002",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ].filter(Boolean);

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    const {
      framework = "IFRS",
      companyName = "the company",
      notes = "",
      priorText = "",
      tbParsed = {},
    } = body;

    if (!priorText || !tbParsed || !Object.keys(tbParsed).length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required data (priorText and tbParsed)." }),
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

    let lastErr = null;
    for (const modelId of candidates) {
      try {
        const text = await tryModel({ GoogleGenerativeAI }, apiKey, modelId, prompt);
        return { statusCode: 200, body: JSON.stringify({ output: text, model: modelId }) };
      } catch (err) {
        const msg = (err && (err.message || String(err))) || "";
        const is404 = /not found|404/i.test(msg);
        const notSupported = /not supported/i.test(msg);
        if (is404 || notSupported) {
          // Try next candidate
          lastErr = err;
          continue;
        }
        // Other errors: report immediately
        console.error(`Model "${modelId}" failed:`, err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Failed to generate", modelTried: modelId, details: msg }),
        };
      }
    }

    console.error("All Gemini model candidates failed.", lastErr);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: (lastErr && (lastErr.message || String(lastErr))) || "All models unavailable",
        tried: candidates,
      }),
    };
  } catch (err) {
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) }),
    };
  }
};







