// netlify/functions/companiesHouse.js
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

    // Call Companies House API
    const url = `https://api.company-information.service.gov.uk/company/${company}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });

    console.log("Companies House status:", response.status);

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    // Handle errors gracefully
    if (!response.ok) {
      console.error("❌ Companies House error:", data);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data.error || "Companies House API request failed",
          details: data
        })
      };
    }

    // Success
    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.error("❌ Unexpected error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
