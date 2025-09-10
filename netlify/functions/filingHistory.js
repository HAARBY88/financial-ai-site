const fetch = require("node-fetch");

exports.handler = async function(event) {
  const companyNumber = event.queryStringParameters?.company;

  if (!companyNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "Company number is required" }) };
  }

  try {
    const url = `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=50`;

    const headers = {
      Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`,
      "Accept": "application/json"
    };

    const response = await fetch(url, { headers });

    const rawText = await response.text();

    console.log("API Response Status:", response.status);
    console.log("API Response Text:", rawText);

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: `API request failed with status ${response.status}`,
          details: rawText
        })
      };
    }

    const data = JSON.parse(rawText);

    // Filter for accounts filings, sort latest first, limit to last 20
    const filings = data.items
      .filter(f => (f.type && f.type.toLowerCase().includes("accounts")) ||
                   (f.description && f.description.toLowerCase().includes("accounts")))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);

    return {
      statusCode: 200,
      body: JSON.stringify({ items: filings })
    };

  } catch (err) {
    console.error("Unexpected error fetching filings:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error fetching filings", details: err.message })
    };
  }
};
