import fetch from "node-fetch";

export async function handler(event) {
  try {
    // 1️⃣ Get the company number from query
    const companyNumber = event.queryStringParameters?.company;
    if (!companyNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing company number in query" })
      };
    }

    // 2️⃣ Get API key from environment
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "API key not set in environment variables" })
      };
    }

    console.log("Company number received:", companyNumber);
    console.log("API key present:", !!apiKey);

    // 3️⃣ Call Companies House API
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}`,
      {
        headers: {
          Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64")
        }
      }
    );

    // 4️⃣ Handle API errors
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Companies House API error:", response.status, errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: `Companies House API error: ${response.status} ${response.statusText}`,
          details: errorText
        })
      };
    }

    // 5️⃣ Parse JSON
    const data = await response.json();

    // 6️⃣ Return to browser
    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.error("Unexpected error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected server error", details: err.message })
    };
  }
}
