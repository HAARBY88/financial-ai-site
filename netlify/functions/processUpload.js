import OpenAI from "openai";
import querystring from "querystring";
import fetch from "node-fetch";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load taxonomy at startup
const taxonomy = JSON.parse(
  fs.readFileSync("./ifrs-taxonomy/taxonomy.json", "utf8")
);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const params = querystring.parse(event.body);

    const selectedFiles = Object.keys(params)
      .filter(k => k.startsWith("file"))
      .map(k => params[k]);

    const topic = params.topic || "General Accounting";
    const question = params.question || "";

    // Fetch filings text
    let extractedText = "";
    for (const fileUrl of selectedFiles) {
      try {
        const res = await fetch(fileUrl, {
          headers: {
            Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`
          }
        });
        extractedText += "\n\n" + (await res.text());
      } catch (err) {
        extractedText += `\n\n⚠️ Error fetching file: ${err.message}`;
      }
    }

    // Add taxonomy info
    const topicInfo = taxonomy[topic] || {};
    const topicContext = `${topic} (${topicInfo.ifrs_reference || "IFRS"}): ${topicInfo.description || ""}\nKey points: ${topicInfo.key_points?.join(", ") || ""}`;

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are an IFRS accounting expert.` },
        { role: "user", content: `Topic: ${topicContext}\n\nUser Question: ${question}\n\nFinancial data extracted:\n${extractedText}` }
      ]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        extracted: extractedText.slice(0, 3000), // prevent payload bloat
        output: response.choices[0].message.content
      })
    };
  } catch (err) {
    console.error("Processing error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Processing failed." }) };
  }
}






