// netlify/functions/filingHistory.js
import fetch from "node-fetch";

export async function handler(event) {
  const companyNumber = event.queryStringParameters.company;

  if (!companyNumber) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Company number is required" })
    };
  }

  try {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Companies House API key" })
      };
    }

    const authHeader =
      "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

    // Request last 25 filings
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=25`,
      { headers: { Authorization: authHeader } }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("❌ Filing history fetch failed:", response.status, text);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "Failed to fetch filing history" })
      };
    }

    const data = await response.json();

    // Filter account filings only
    const filings = data.items.filter((f) => {
      return (
        f.description &&
        f.description.toLowerCase().includes("accounts") &&
        f.links?.document_metadata
      );
    });

    // Map to cleaner object
    const cleaned = filings.map((f) => ({
      date: f.date,
      description: f.description,
      type: f.type,
      category: f.category,
      document_metadata: f.links.document_metadata
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ items: cleaned })
    };
  } catch (err) {
    console.error("❌ Filing history error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}




