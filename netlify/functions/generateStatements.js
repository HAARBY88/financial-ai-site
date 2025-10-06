// netlify/functions/generateStatements.js
async function getGemini() {
  // Dynamically import inside Netlify function to avoid ESM bundling issues
  const mod = await import("@google/generative-ai");
  return mod;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error("Missing GEMINI_API_KEY in environment");
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }

    // Parse JSON body safely
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      body = {};
    }

    const {
      framework = "IFRS",
      companyName = "the company",
      notes = "",
      priorText = "",
      tbParsed = {}
    } = body;

    if (!priorText || !Object.keys(tbParsed).length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required data (priorText or tbParsed)." })
      };
    }

    // Load Gemini
    const { GoogleGenerativeAI } = await getGemini();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
You are an expert ${framework} financial reporting assistant.
Generate a concise draft of the current year's financial statements for ${companyName}.
Use the structure, tone, and note style evident in the prior year's report text.
Incorporate trial balance movements and align presentation to ${framework}.

Inputs:
- Prior-year report text: ${priorText.slice(0, 12000)}
- Current trial balance: ${JSON.stringify(tbParsed.current || {}, null, 2)}
- Prior-year trial balance: ${JSON.stringify(tbParsed.prior || {}, null, 2)}
- Notes / additional instructions: ${notes}

Return your response as clear formatted text sections (Profit or Loss, Balance Sheet, Notes).`;

    // Generate output
    const result = await model.generateContent(prompt);
    const text = (await result.response?.text?.()) || "No text generated.";

    return {
      statusCode: 200,
      body: JSON.stringify({ output: text })
    };

  } catch (err) {
    console.error("generateStatements error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to generate",
        details: err.message || err.toString()
      })
    };
  }
}





