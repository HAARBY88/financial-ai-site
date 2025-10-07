// netlify/functions/generateStatements.js

// Dynamic import to keep ESM package happy in Netlify functions
async function getGemini() {
  const mod = await import("@google/generative-ai");
  return mod;
}

// Helper: run one model attempt
async function tryModel({ GoogleGenerativeAI }, apiKey, modelId, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });
  const res = await model.generateContent(prompt);
  const out = await res.response?.text?.();
  return out || "No output generated.";
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    // Preferred model from env, otherwise we’ll try these in order:
    const candidates = [
      process.env.GEMINI_MODEL,           // (optional) your explicit choice
      "gemini-1.5-flash-002",
      "gemini-1.5-pro-002",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ].filter(Boolean); // remove empty

    // Parse request body
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

    // Build prompt
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

    // Load SDK once
    const { GoogleGenerativeAI } = await getGemini();

    // Try models in order until one works
    let lastErr = null;
    for (const modelId of candidates) {
      try {
        const text = await tryModel({ GoogleGenerativeAI }, apiKey, modelId, prompt);
        return { statusCode: 200, body: JSON.stringify({ output: text, model: modelId }) };
      } catch (err) {
        // If the model is not found or not supported, try the next one
        const msg = (err && (err.message || err.toString())) || "";
        const is404 = /not found|404/i.test(msg);
        const notSupported = /not supported/i.test(msg);
        if (is404 || notSupported) {
          lastErr = err;
          continue; // try next candidate
        }
        // Other errors: stop and report
        console.error(`Model "${modelId}" failed:`, err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Failed to generate", modelTried: modelId, details: msg })
        };
      }
    }

    // If we exhausted all candidates
    console.error("All Gemini model candidates failed.", lastErr);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: (lastErr && (lastErr.message || lastErr.toString())) || "All models unavailable",
        tried: candidates
      })
    };
  } catch (err) {
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate", details: err?.message || String(err) })
    };
  }
}

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






