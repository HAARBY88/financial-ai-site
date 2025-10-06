// netlify/functions/generateStatements.js

// Dynamic import keeps ESM package happy inside Netlify functions
async function getGemini() {
  const mod = await import("@google/generative-ai");
  return mod;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    // Allow overriding model via env var; default to a supported model
    const modelId = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

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
        body: JSON.stringify({ error: "Missing required data (priorText and tbParsed are required)." })
      };
    }

    const { GoogleGenerativeAI } = await getGemini();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });

    const prompt = `
You are an expert ${framework} financial reporting assistant.
Generate a professional draft of current-year financial statements for ${companyName}.
Use the style of the prior report, and map amounts from TBs. Flag any missing disclosures.

Inputs:
- Prior-year report text (style source):
${priorText.slice(0, 12000)}

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

    const result = await model.generateContent(prompt);
    const text = (await result.response?.text?.()) || "No output generated.";

    return { statusCode: 200, body: JSON.stringify({ output: text, model: modelId }) };
  } catch (err) {
    // Bubble useful details back to the page for debugging
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: err?.message || String(err)
      })
    };
  }
}





