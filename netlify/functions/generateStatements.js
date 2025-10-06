async function getGemini() {
  const mod = await import("@google/generative-ai");
  return mod;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    if (!process.env.GEMINI_API_KEY)
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };

    const body = JSON.parse(event.body || "{}");
    const { framework = "IFRS", companyName = "", notes = "", priorText = "", tbParsed = {} } = body;

    const { GoogleGenerativeAI } = await getGemini();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
You are an expert ${framework} financial reporting assistant.
Generate a professional draft set of financial statements for ${companyName || "the company"}.

Inputs:
- Prior-year report text (style): ${priorText.slice(0, 12000)}
- Current TB: ${JSON.stringify(tbParsed.current || {}, null, 2)}
- Prior TB: ${JSON.stringify(tbParsed.prior || {}, null, 2)}
- Notes: ${notes}

Include:
1) Profit or loss with comparatives
2) Balance sheet with comparatives
3) Key IFRS/US GAAP compliant notes
4) Highlight missing disclosures
`;

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "No output generated.";

    return { statusCode: 200, body: JSON.stringify({ output: text }) };
  } catch (error) {
    console.error("generateStatements error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate", details: error.message }) };
  }
}






