// netlify/functions/generateStatements.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };
  try {
    if (!process.env.GEMINI_API_KEY) {
      return { statusCode:500, body: JSON.stringify({ error:"Missing GEMINI_API_KEY" }) };
    }

    const { framework = "IFRS", companyName = "", notes = "", priorText = "", tbParsed = {} } =
      JSON.parse(event.body || "{}");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
You are a professional ${framework} financial reporting assistant.
Your task: draft a full set of financial statements for ${companyName || "the Company"} for the current year using:
- Prior-year statements text (style, structure, wording)
- Current and prior Trial Balances (account names + amounts)
- The selected framework: ${framework}

Constraints:
- Keep the prior-year structure and tone where possible.
- Update all numeric amounts using the CURRENT TB.
- Where comparative numbers are shown, use the PRIOR TB.
- Highlight if key disclosures are missing (e.g., revenue policy, leases, financial instruments).
- Do not invent facts; if unsure, leave a clear placeholder like "[information required]".

If ${framework} is IFRS, align with IFRS presentation (IAS 1, IFRS 15, IFRS 16, IFRS 7).
If ${framework} is US GAAP, align with standard US GAAP presentation and terminology.

Optional instructions from the user: ${notes || "(none)"}

PRIOR-YEAR STATEMENTS (style source):
<<<
${priorText.slice(0, 20000)}
>>>

TRIAL BALANCES (key-value maps):
CURRENT YEAR TB:
${JSON.stringify(tbParsed.current || {}, null, 2)}

PRIOR YEAR TB:
${JSON.stringify(tbParsed.prior || {}, null, 2)}

Output a clean, human-readable draft with these sections:
1) Statement of Profit or Loss (with comparatives)
2) Statement of Financial Position (with comparatives)
3) Statement of Changes in Equity (summary)
4) Statement of Cash Flows (indirect method)
5) Basis of preparation & significant accounting policies
6) Key notes: revenue, leases, financial instruments, PPE/intangibles, provisions, contingencies
7) Any missing disclosures list

Use professional headings and consistent formatting.
    `;

    const result = await model.generateContent(prompt);
    const answer = result?.response?.text?.() || "No output.";

    return { statusCode:200, body: JSON.stringify({ output: answer }) };
  } catch (err) {
    console.error("generateStatements error:", err);
    return { statusCode:500, body: JSON.stringify({ error:"Failed to generate statements", details: err.message }) };
  }
}



