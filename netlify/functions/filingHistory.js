const fetch = require("node-fetch");

exports.handler = async function(event) {
  const companyNumber = event.queryStringParameters?.company;
  if (!companyNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "Company number is required" }) };
  }

  try {
    const url = `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=10`;
    const headers = {
      Authorization: `Basic ${Buffer.from(process.env.COMPANIES_HOUSE_KEY + ":").toString("base64")}`,
      Accept: "application/json"
    };

    const response = await fetch(url, { headers });

    // Debug logging
    console.log("Filing history status:", response.status);
    console.log("Response headers:", response.headers.raw());

    const rawText = await response.text();
    console.log("Raw response text:", rawText);

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: "API request failed", 
          status: response.status, 
          response: rawText 
        })
      };
    }

    const data = JSON.parse(rawText);

    const filings = data.items
      .filter(f => (f.type && f.type.toLowerCase().includes("accounts")) ||
                   (f.description && f.description.toLowerCase().includes("accounts")))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    return { statusCode: 200, body: JSON.stringify({ items: filings }) };

  } catch (err) {
    console.error("Error fetching filings:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};


