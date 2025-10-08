// netlify/functions/generateStatements.js
function normalize(name = "") { return name.replace(/^models\//i, ""); }

async function listModels(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`);
  const txt = await res.text();
  if (!res.ok) throw new Error(`ListModels HTTP ${res.status}: ${txt}`);
  const data = JSON.parse(txt);
  const arr = Array.isArray(data) ? data : (data.models || []);
  return arr.map(m => ({ id: normalize(m?.name || m?.model || ""), raw: m })).filter(m => m.id);
}

async function generateWithModel({ apiKey, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }]}] })
  });
  const txt = await res.text();
  if (!res.ok) {
    const e = new Error(`Gemini HTTP ${res.status}: ${txt}`);
    e.status = res.status;
    throw e;
  }
  const data = JSON.parse(txt);
  const cands = data.candidates || [];
  const first = cands[0] || {};
  const parts = first.content?.parts || [];
  const textPart = parts.find(p => typeof p.text === "string");
  return textPart?.text || "No text generated.";
}

module.exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const { framework = "IFRS", companyName = "the company", notes = "", priorText = "", tbParsed = {} } = body;

    if (!priorText || !tbParsed || !Object.keys(tbParsed).length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required data (priorText and tbParsed)." }) };
    }

    const all = await listModels(apiKey);
    if (!all.length) {
      return { statusCode: 500, body: JSON.stringify({ error: "No models visible to this API key." }) };
    }

    const supportsGenerate = (m) => {
      const methods = m.raw?.supportedGenerationMethods || m.raw?.supportedMethods || [];
      return Array.isArray(methods) ? methods.includes("generateContent") : true;
    };
    const usable = all.filter(supportsGenerate).map(m => m.id);
    if (!usable.length) {
      return { statusCode: 500, body: JSON.stringify({ error: "No usable models for this key.", modelsAvailable: all.map(m => m.id) }) };
    }

    const preferred = [
      "gemini-1.5-flash-002",
      "gemini-1.5-pro-002",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro",
      "gemini-1.0-pro"
    ];
    const chosen = preferred.find(m => usable.includes(m)) || usable[0];

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

    const output = await generateWithModel({ apiKey, model: chosen, prompt });
    return { statusCode: 200, body: JSON.stringify({ output, model: chosen }) };
  } catch (err) {
    console.error("generateStatements fatal:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate", details: err.message || String(err) }) };
  }
};










