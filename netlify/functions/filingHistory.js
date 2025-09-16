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

    // 🔎 Debug: log all filings returned
    console.log("📄 Raw filings from Companies House:", JSON.stringify(data.items, null, 2));

    // Filter: only filings that mention "accounts" AND have a valid document_metadata link
    const filings = (data.items || []).filter((f) => {
      return (
        f.description &&
        f.description.toLowerCase().includes("accounts") &&
        f.links &&
        f.links.document_metadata
      );
    });

    // Map to safe structure (defaults if fields missing)
    const cleaned = filings.map((f) => ({
      date: f.date || "Unknown date",
      description: f.description || "No description",
      type: f.type || "N/A",
      category: f.category || "N/A",
      document_metadata: f.links?.document_metadata || null
    }));

    // 🔎 Debug: show cleaned results before returning
    console.log("✅ Cleaned filings returned to frontend:", JSON.stringify(cleaned, null, 2));

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







