// netlify/functions/searchCompanies.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const query = event.queryStringParameters.q;
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing search query" }) };
    }

    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing API key" }) };
    }
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`;
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.error || "Search failed" }) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
