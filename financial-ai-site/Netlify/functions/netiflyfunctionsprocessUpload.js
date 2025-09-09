import OpenAI from "openai";
import fetch from "node-fetch";

export async function handler(event) {
  const { docId } = event.queryStringParameters;
  if (!docId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing docId" }) };
  }

  try {
    // Get document text from Companies House
    const res = await fetch(`https://document-api.company-information.service.gov.uk${docId}/content`, {
      headers: {
        Authorization: "Basic " + Buffer.from(process.env.COMPANIES_HOUSE_API_KEY + ":").toString("base64")
      }
    });
    const text = await res.text();

    // Send to OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert in IFRS & US GAAP reporting." },
        { role: "user", content: `Analyse this filing:\n${text}` }
      ]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ output: response.choices[0].message.content })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
