// netlify/functions/filingHistory.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const company = event.queryStringParameters.company;
    if (!company) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing company number" })
      };
    }

    // Get API key from Netlify env
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      console.error("❌ COMPANIES_HOUSE_API_KEY is not set in environment.");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Server misconfiguration: API key missing" })
      };
    }

    // Build Basic Auth header (API_KEY + ":")
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    // Call Companies House filing history API
    const url = `https://api.company-information.service.gov.uk/company/${company}/filing-history?items_per_page=50`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });

    console.log("Filing history status:", response.status);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    // Handle errors gracefully
    if (!response.ok) {
      console.error("❌ Filing history error:", data);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data.error || "Companies House filing history request failed",
          details: data
        })
      };
    }

    // Filter filings: only "accounts"
    const filings = (data.items || [])
      .filter(f =>
        (f.type && f.type.toLowerCase().includes("accounts")) ||
        (f.description && f.description.toLowerCase().includes("accounts"))
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10); // last 10 filings

    // Success
    return {
      statusCode: 200,
      body: JSON.stringify({ items: filings })
    };

  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};


